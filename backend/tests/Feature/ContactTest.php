<?php

namespace Tests\Feature;

use App\Jobs\ProcessContactImportJob;
use App\Models\Contact;
use App\Models\SuppressionEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class ContactTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    public function test_create_normalises_phone_and_rejects_duplicates(): void
    {
        $t = $this->tenant();
        $res = $this->postJson('/api/v1/app/contacts', ['name' => 'Asha', 'phone' => '01712-345678', 'email' => 'ASHA@x.com', 'tags' => 'VIP Customer, vip customer', 'customFields' => "city=Dhaka\nzone=North"], $t['headers']);
        $res->assertCreated()->assertJsonPath('data.phone', '+8801712345678')->assertJsonPath('data.email', 'asha@x.com')
            ->assertJsonPath('data.tags', ['vip-customer'])->assertJsonPath('data.customFields.city', 'Dhaka');
        $this->postJson('/api/v1/app/contacts', ['phone' => '+8801712345678'], $t['headers'])->assertStatus(409)->assertJsonPath('error.details.field', 'phone');
        $this->postJson('/api/v1/app/contacts', ['phone' => '12345'], $t['headers'])->assertStatus(422)->assertJsonPath('error.details.fields.0.path', 'phone');
    }

    public function test_update_delete_restore_and_opt_out_sync(): void
    {
        $t = $this->tenant();
        $id = $this->postJson('/api/v1/app/contacts', ['phone' => '01712345678'], $t['headers'])->json('data.id');
        $this->putJson("/api/v1/app/contacts/{$id}", ['phone' => '01712345678', 'name' => 'New', 'consentStatus' => 'OPTED_OUT'], $t['headers'])->assertOk()->assertJsonPath('data.name', 'New');
        $this->assertTrue(SuppressionEntry::query()->where('organizationId', $t['org']->id)->where('phone', '+8801712345678')->exists());
        $this->deleteJson("/api/v1/app/contacts/{$id}", [], $t['headers'])->assertOk();
        $this->getJson("/api/v1/app/contacts/{$id}", $t['headers'])->assertStatus(404);
        // Re-adding a deleted number restores the record (unique per organization).
        $this->postJson('/api/v1/app/contacts', ['phone' => '01712345678'], $t['headers'])->assertCreated()->assertJsonPath('data.id', $id);
    }

    public function test_search_filter_sort_and_pagination(): void
    {
        $t = $this->tenant();
        for ($i = 0; $i < 30; $i++) {
            Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => sprintf('+88017123456%02d', $i), 'name' => "Person {$i}", 'tags' => $i % 2 ? ['odd'] : []]);
        }
        $this->getJson('/api/v1/app/contacts?sort=oldest', $t['headers'])->assertOk()->assertJsonPath('meta.total', 30)->assertJsonPath('meta.pageSize', 25)->assertJsonPath('meta.totalPages', 2)->assertJsonCount(25, 'data');
        $this->getJson('/api/v1/app/contacts?page=2', $t['headers'])->assertJsonCount(5, 'data');
        Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801812345678', 'name' => 'Zainab', 'company' => 'Zed Ltd']);
        $this->getJson('/api/v1/app/contacts?q=zainab', $t['headers'])->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/app/contacts?q=zed', $t['headers'])->assertJsonPath('meta.total', 1);
        $this->getJson('/api/v1/app/contacts?q=01712345605', $t['headers'])->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.name', 'Person 5');
        $this->getJson('/api/v1/app/contacts?tag=odd', $t['headers'])->assertJsonPath('meta.total', 15);
        $this->getJson('/api/v1/app/contacts?q=%25', $t['headers'])->assertJsonPath('meta.total', 0); // LIKE wildcards are escaped
        $this->getJson('/api/v1/app/contacts/tags', $t['headers'])->assertJsonPath('data', ['odd']);
    }

    public function test_groups_assignment_bulk_actions_and_counts(): void
    {
        $t = $this->tenant();
        $gid = $this->postJson('/api/v1/app/contact-groups', ['name' => 'VIP'], $t['headers'])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/app/contact-groups', ['name' => 'VIP'], $t['headers'])->assertStatus(409);
        $ids = [];
        foreach (['01712345671', '01712345672', '01712345673'] as $p) {
            $ids[] = $this->postJson('/api/v1/app/contacts', ['phone' => $p], $t['headers'])->json('data.id');
        }
        $this->postJson("/api/v1/app/contact-groups/{$gid}/contacts", ['ids' => $ids], $t['headers'])->assertOk()->assertJsonPath('data.updated', 3);
        $this->getJson("/api/v1/app/contact-groups/{$gid}", $t['headers'])->assertJsonPath('data.count', 3);
        $this->postJson('/api/v1/app/contacts/bulk', ['ids' => [$ids[0]], 'action' => ['type' => 'delete']], $t['headers'])->assertOk();
        $this->getJson('/api/v1/app/contact-groups', $t['headers'])->assertJsonPath('data.0.count', 2);
        $this->postJson('/api/v1/app/contacts/bulk', ['ids' => $ids, 'action' => ['type' => 'addTag', 'tag' => 'Gold Tier']], $t['headers'])->assertJsonPath('data.updated', 2);
        $this->assertSame(['gold-tier'], Contact::query()->findOrFail($ids[1])->tags);
        $this->postJson('/api/v1/app/contacts/bulk', ['ids' => $ids, 'action' => ['type' => 'setConsent', 'consent' => 'OPTED_OUT']], $t['headers'])->assertOk();
        $this->assertSame(2, SuppressionEntry::query()->where('organizationId', $t['org']->id)->count());
        $this->getJson("/api/v1/app/contact-groups/{$gid}/contacts", $t['headers'])->assertJsonPath('meta.total', 2);
        $this->deleteJson("/api/v1/app/contact-groups/{$gid}", [], $t['headers'])->assertOk();
        $this->assertSame(2, Contact::query()->where('organizationId', $t['org']->id)->count()); // contacts kept
    }

    public function test_other_tenants_contacts_and_groups_are_invisible(): void
    {
        $a = $this->tenant();
        $b = $this->tenant();
        $id = $this->postJson('/api/v1/app/contacts', ['phone' => '01712345678'], $a['headers'])->json('data.id');
        $gid = $this->postJson('/api/v1/app/contact-groups', ['name' => 'A'], $a['headers'])->json('data.id');
        $this->getJson("/api/v1/app/contacts/{$id}", $b['headers'])->assertStatus(404);
        $this->putJson("/api/v1/app/contacts/{$id}", ['phone' => '01712345678'], $b['headers'])->assertStatus(404);
        $this->postJson('/api/v1/app/contacts/bulk', ['ids' => [$id], 'action' => ['type' => 'delete']], $b['headers'])->assertJsonPath('data.updated', 0);
        $this->assertNotNull(Contact::query()->find($id));
        $this->postJson('/api/v1/app/contacts', ['phone' => '01812345678', 'groupIds' => [$gid]], $b['headers'])->assertStatus(422);
        $this->getJson('/api/v1/app/contacts', $b['headers'])->assertJsonPath('meta.total', 0);
    }

    public function test_csv_import_validates_rows_dedupes_and_maps_headers(): void
    {
        $t = $this->tenant();
        $gid = $this->postJson('/api/v1/app/contact-groups', ['name' => 'Imported'], $t['headers'])->json('data.id');
        $csv = "\u{FEFF}Mobile,Full Name,Email,Tags,City,Consent\n01712345671,Asha,asha@x.com,\"a;b\",Dhaka,opted-in\n01712345671,Dup,,,,\nnot-a-number,Bad,,,,\n,,,,,\n'+8801712345672,Bilal,bad-email,,Sylhet,OPTED_OUT\n";
        $file = UploadedFile::fake()->createWithContent('contacts.csv', $csv);
        $res = $this->post('/api/v1/app/contacts/import', ['file' => $file, 'groupId' => $gid], $t['headers'] + ['Accept' => 'application/json']);
        $res->assertOk()->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.result.total', 4)->assertJsonPath('data.result.created', 2)->assertJsonPath('data.result.duplicates', 1)
            ->assertJsonPath('data.result.invalid.0.row', 4)->assertJsonPath('data.result.suppressed', 1);
        $asha = Contact::query()->where('phone', '+8801712345671')->firstOrFail();
        $this->assertSame(['Asha', ['a', 'b'], ['city' => 'Dhaka'], 'OPTED_IN'], [$asha->name, $asha->tags, $asha->customFields, $asha->consentStatus->value]);
        $this->assertNull(Contact::query()->where('phone', '+8801712345672')->value('email'));
        $this->getJson("/api/v1/app/contact-groups/{$gid}", $t['headers'])->assertJsonPath('data.count', 2);
    }

    public function test_import_rejects_bad_files(): void
    {
        $t = $this->tenant();
        $h = $t['headers'] + ['Accept' => 'application/json'];
        $this->post('/api/v1/app/contacts/import', ['file' => UploadedFile::fake()->create('x.exe', 10, 'application/x-msdownload')], $h)->assertStatus(422);
        $this->post('/api/v1/app/contacts/import', ['file' => UploadedFile::fake()->createWithContent('x.csv', "name\nAsha\n")], $h)->assertStatus(422)->assertJsonPath('error.message', 'The file needs a column named phone (or mobile / number).');
        $this->post('/api/v1/app/contacts/import', ['file' => UploadedFile::fake()->createWithContent('x.csv', "phone\n")], $h)->assertStatus(422)->assertJsonPath('error.message', 'The file has no data rows.');
        $this->post('/api/v1/app/contacts/import', ['file' => UploadedFile::fake()->createWithContent('x.csv', "phone\n\0\0binary")], $h)->assertStatus(422);
        $this->post('/api/v1/app/contacts/import', ['file' => UploadedFile::fake()->create('big.csv', 11 * 1024, 'text/csv')], $h)->assertStatus(422);
    }

    public function test_large_import_is_queued_and_status_is_tenant_scoped(): void
    {
        Queue::fake();
        Storage::fake('local');
        config(['smsflow.uploads.csv_sync_max_bytes' => 10]);
        $t = $this->tenant();
        $res = $this->post('/api/v1/app/contacts/import', ['file' => UploadedFile::fake()->createWithContent('c.csv', "phone\n01712345678\n")], $t['headers'] + ['Accept' => 'application/json'])
            ->assertStatus(202)->assertJsonPath('data.status', 'queued');
        Queue::assertPushed(ProcessContactImportJob::class);
        Storage::disk('local')->assertExists('imports/'.$t['org']->id.'/'.$res->json('data.importId').'.csv');
        $importId = $res->json('data.importId');
        $this->getJson("/api/v1/app/contacts/imports/{$importId}", $t['headers'])->assertOk()->assertJsonPath('data.status', 'queued');
        $this->getJson("/api/v1/app/contacts/imports/{$importId}", $this->tenant()['headers'])->assertStatus(404);
    }

    public function test_export_is_csv_injection_safe(): void
    {
        $t = $this->tenant();
        $this->postJson('/api/v1/app/contacts', ['phone' => '01712345678', 'name' => '=HYPERLINK("http://x")'], $t['headers']);
        $csv = $this->get('/api/v1/app/contacts/export', $t['headers'])->assertOk()->assertHeader('Content-Type', 'text/csv; charset=utf-8')->streamedContent();
        $this->assertStringStartsWith("\u{FEFF}\"phone\"", $csv);
        $this->assertStringContainsString('"\'=HYPERLINK(""http://x"")"', $csv);
    }

    public function test_suppression_list(): void
    {
        $t = $this->tenant();
        $id = $this->postJson('/api/v1/app/suppression', ['phone' => '01712345678', 'reason' => 'COMPLAINT', 'note' => 'n'], $t['headers'])->assertCreated()->json('data.id');
        $this->getJson('/api/v1/app/suppression?q=0171', $t['headers'])->assertJsonPath('meta.total', 1);
        $this->deleteJson("/api/v1/app/suppression/{$id}", [], $this->tenant()['headers'])->assertStatus(404);
        $this->deleteJson("/api/v1/app/suppression/{$id}", [], $t['headers'])->assertOk();
    }

    public function test_viewer_can_read_but_not_write(): void
    {
        $v = $this->tenant('0', 'VIEWER');
        $this->getJson('/api/v1/app/contacts', $v['headers'])->assertOk();
        $this->postJson('/api/v1/app/contacts', ['phone' => '01712345678'], $v['headers'])->assertStatus(403);
        $this->get('/api/v1/app/contacts/export', $v['headers'])->assertStatus(403);
    }
}
