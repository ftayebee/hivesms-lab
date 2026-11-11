<?php

namespace Tests\Feature;

use App\Exceptions\AppException;
use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\CampaignUpload;
use App\Models\Message;
use App\Models\SenderId;
use App\Models\WalletTransaction;
use App\Services\Campaign\DynamicSmsService;
use App\Services\Messaging\DispatcherService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Dynamic SMS: CSV upload, column mapping, strict per-row rendering, launch (docs/20). */
class DynamicSmsTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const CSV = "\u{FEFF}Retail Name,Mobile Number,Due Amount,Invoice\r\nRahim Store,01712345678,1500,INV-001\r\nKarim Traders,01812345678,2500,INV-002\r\nNoor Enterprise,01912345678,3000,INV-003\r\n";

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
        config(['smsflow.features.dynamic_sms' => true]);
        Storage::fake('local');
    }

    private function upload(array $t, string $csv = self::CSV, string $name = 'list.csv')
    {
        return $this->withHeaders($t['headers'] + ['Accept' => 'application/json'])
            ->post('/api/v1/app/dynamic-sms/uploads', ['file' => UploadedFile::fake()->createWithContent($name, $csv)]);
    }

    private function body(string $uploadId, array $over = []): array
    {
        return $over + [
            'uploadId' => $uploadId, 'recipientColumn' => 'Mobile Number', 'smsType' => 'TRANSACTIONAL', 'name' => 'Dues',
            'message' => 'Dear {{Retail Name}}, your due amount is BDT {{Due Amount}}. Invoice: {{Invoice}}', 'batchSize' => 10,
        ];
    }

    public function test_feature_flag_gates_every_endpoint(): void
    {
        config(['smsflow.features.dynamic_sms' => false]);
        $t = $this->tenant();
        $this->upload($t)->assertStatus(403)->assertJsonPath('error.code', 'FEATURE_DISABLED');
    }

    public function test_upload_detects_headers_bom_and_previews_rows(): void
    {
        $t = $this->tenant();
        $r = $this->upload($t)->assertCreated();
        $r->assertJsonPath('data.headers', ['Retail Name', 'Mobile Number', 'Due Amount', 'Invoice'])
            ->assertJsonPath('data.rowCount', 3)
            ->assertJsonPath('data.preview.0.cells.Retail Name', 'Rahim Store')
            ->assertJsonPath('data.suggestedRecipientColumn', 'Mobile Number');
        $u = CampaignUpload::query()->findOrFail($r->json('data.id'));
        $this->assertStringStartsWith("orgs/{$t['org']->id}/dynamic-sms/", $u->fileKey);
        Storage::disk('local')->assertExists($u->fileKey);
    }

    public function test_malformed_files_are_rejected(): void
    {
        $t = $this->tenant();
        $this->upload($t, "Name,Phone\n")->assertStatus(422)->assertJsonPath('error.details.field', 'file');
        $this->upload($t, "Name,Name\nA,01712345678\n")->assertStatus(422);
        $this->upload($t, "Name,{{x}}\nA,01712345678\n")->assertStatus(422);
        $this->upload($t, "Name,Phone\n\xff\xfe,01712345678\n")->assertStatus(422); // not UTF-8
        $this->upload($t, "PK\0\0binary", 'list.csv')->assertStatus(422);
        $this->upload($t, self::CSV, 'list.xlsx')->assertStatus(422);
        config(['smsflow.campaign_processing.maxDynamicRows' => 2]);
        $this->upload($t)->assertStatus(422);
    }

    public function test_recipient_and_sender_columns_are_excluded_from_merge_fields(): void
    {
        $svc = app(DynamicSmsService::class);
        $map = $svc->resolveMapping(['Retail Name', 'Mobile Number', 'Sender ID', 'Due Amount'], ['recipientColumn' => 'Mobile Number', 'senderColumn' => 'Sender ID']);
        $this->assertSame(['Retail Name', 'Due Amount'], $map['fields']);
        $this->assertSame(['Retail Name'], $svc->templateFields('Hi {{ retail name }}', $map['fields']));
        try {
            $svc->templateFields('Your number {{Mobile Number}}', $map['fields'], ['Mobile Number', 'Sender ID']);
            $this->fail('recipient column accepted as a field');
        } catch (AppException $e) {
            $this->assertStringContainsString('cannot be used', $e->getMessage());
        }
        $this->expectException(AppException::class);
        $svc->templateFields('Hello {{Unknown}}', $map['fields']);
    }

    public function test_preview_renders_each_row_with_its_own_values(): void
    {
        $t = $this->tenant('100');
        $id = $this->upload($t)->json('data.id');
        $r = $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id), $t['headers'])->assertOk();
        $r->assertJsonPath('data.stats.valid', 3)->assertJsonPath('data.stats.totalRows', 3)
            ->assertJsonPath('data.fields', ['Retail Name', 'Due Amount', 'Invoice'])
            ->assertJsonPath('data.rows.0.recipient', '+8801712345678')
            ->assertJsonPath('data.rows.0.message', 'Dear Rahim Store, your due amount is BDT 1500. Invoice: INV-001')
            ->assertJsonPath('data.rows.1.message', 'Dear Karim Traders, your due amount is BDT 2500. Invoice: INV-002')
            ->assertJsonPath('data.rows.2.message', 'Dear Noor Enterprise, your due amount is BDT 3000. Invoice: INV-003');
        // Unknown placeholder → 422, never an empty substitution.
        $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id, ['message' => 'Hi {{Nope}}']), $t['headers'])->assertStatus(422)->assertJsonPath('error.details.field', 'message');
        $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id, ['recipientColumn' => '']), $t['headers'])->assertStatus(422);
    }

    public function test_invalid_duplicate_and_missing_values_are_counted_and_skipped(): void
    {
        $t = $this->tenant('100');
        $csv = "Name,Phone,Amount\nA,01712345678,10\nB,12345,20\nC,+8801712345678,30\nD,01812345678,\n,,\nE,01912345678,50,extra\n";
        $id = $this->upload($t, $csv)->json('data.id');
        $r = $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id, ['recipientColumn' => 'Phone', 'message' => '{{Name}} owes {{Amount}}']), $t['headers'])->assertOk();
        $r->assertJsonPath('data.stats.totalRows', 5)->assertJsonPath('data.stats.valid', 1)->assertJsonPath('data.stats.invalidPhone', 1)
            ->assertJsonPath('data.stats.duplicates', 1)->assertJsonPath('data.stats.missingValues', 1)->assertJsonPath('data.stats.malformed', 1);
        // missingValues=reject blocks the submission instead of skipping.
        $this->postJson('/api/v1/app/dynamic-sms/estimate', $this->body($id, ['recipientColumn' => 'Phone', 'message' => '{{Name}} owes {{Amount}}', 'missingValues' => 'reject']), $t['headers'])
            ->assertStatus(422)->assertJsonPath('error.details.field', 'missingValues');
    }

    public function test_bangla_unicode_segments_and_per_row_cost(): void
    {
        $t = $this->tenant('100');
        $csv = "নাম,Phone\nরহিম,01712345678\n".str_repeat('ক', 80).",01812345678\n";
        $id = $this->upload($t, $csv)->json('data.id');
        $r = $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id, ['recipientColumn' => 'Phone', 'message' => 'প্রিয় {{নাম}}']), $t['headers'])->assertOk();
        $r->assertJsonPath('data.rows.0.encoding', 'UCS2')->assertJsonPath('data.rows.0.segments', 1)->assertJsonPath('data.rows.0.message', 'প্রিয় রহিম')
            ->assertJsonPath('data.rows.1.segments', 2)->assertJsonPath('data.stats.segments', 3)->assertJsonPath('data.stats.estimatedCost', '1.20');
    }

    public function test_sender_column_must_hold_approved_sender_ids_of_this_organization(): void
    {
        $t = $this->tenant('100');
        $other = $this->tenant('100');
        SenderId::query()->forceCreate(['organizationId' => $t['org']->id, 'value' => 'ACME', 'type' => 'MASKING', 'status' => 'APPROVED', 'documents' => []]);
        SenderId::query()->forceCreate(['organizationId' => $t['org']->id, 'value' => 'PENDINGID', 'type' => 'MASKING', 'status' => 'PENDING', 'documents' => []]);
        SenderId::query()->forceCreate(['organizationId' => $other['org']->id, 'value' => 'OTHERCO', 'type' => 'MASKING', 'status' => 'APPROVED', 'documents' => []]);
        $csv = "Name,Phone,Sender\nA,01712345671,ACME\nB,01712345672,PENDINGID\nC,01712345673,OTHERCO\nD,01712345674,\n";
        $id = $this->upload($t, $csv)->json('data.id');
        $r = $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id, ['recipientColumn' => 'Phone', 'senderColumn' => 'Sender', 'message' => 'Hi {{Name}}']), $t['headers'])->assertOk();
        $r->assertJsonPath('data.stats.valid', 2)->assertJsonPath('data.stats.invalidSender', 2)
            ->assertJsonPath('data.rows.0.sender', 'ACME')->assertJsonPath('data.fields', ['Name']);
        // The sender column cannot be personalised.
        $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id, ['recipientColumn' => 'Phone', 'senderColumn' => 'Sender', 'message' => 'From {{Sender}}']), $t['headers'])->assertStatus(422);
    }

    public function test_submit_requires_confirmation_launches_once_and_stores_template_and_rendered_text(): void
    {
        $t = $this->tenant('100');
        $id = $this->upload($t)->json('data.id');
        $this->postJson('/api/v1/app/dynamic-sms/estimate', $this->body($id), $t['headers'])->assertOk()
            ->assertJsonPath('data.recipients', 3)->assertJsonPath('data.estimatedCost', '1.20')->assertJsonPath('data.variables', ['Retail Name', 'Due Amount', 'Invoice'])
            ->assertJsonPath('data.batches', 1)->assertJsonPath('data.requiresReview', false);
        $this->postJson('/api/v1/app/dynamic-sms/submit', $this->body($id), $t['headers'])->assertStatus(422)->assertJsonPath('error.details.field', 'confirmed');
        $cid = $this->postJson('/api/v1/app/dynamic-sms/submit', $this->body($id, ['confirmed' => true]), $t['headers'])->assertStatus(202)->json('data.id');
        // The same upload cannot create a second campaign.
        $this->postJson('/api/v1/app/dynamic-sms/submit', $this->body($id, ['confirmed' => true]), $t['headers'])->assertStatus(409);

        $c = Campaign::query()->findOrFail($cid);
        $this->assertSame(['DYNAMIC', 'PROCESSING', 10], [$c->kind->value, $c->status->value, $c->batchSize]);
        $this->assertSame('Dear {{Retail Name}}, your due amount is BDT {{Due Amount}}. Invoice: {{Invoice}}', $c->message);
        $bodies = Message::query()->where('campaignId', $cid)->orderBy('to')->pluck('body', 'to')->all();
        $this->assertSame([
            '+8801712345678' => 'Dear Rahim Store, your due amount is BDT 1500. Invoice: INV-001',
            '+8801812345678' => 'Dear Karim Traders, your due amount is BDT 2500. Invoice: INV-002',
            '+8801912345678' => 'Dear Noor Enterprise, your due amount is BDT 3000. Invoice: INV-003',
        ], $bodies);
        $this->assertSame(['Retail Name' => 'Karim Traders', 'Due Amount' => '2500', 'Invoice' => 'INV-002'], CampaignRecipient::query()->where('campaignId', $cid)->where('phone', '+8801812345678')->first()->variables);
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'SMS_CHARGE')->where('referenceId', $cid)->count());
        $this->assertSame('98.8000', $this->balance($t['org']));

        app(DispatcherService::class)->processCampaignBatches(5);
        $this->assertSame(3, Message::query()->where('campaignId', $cid)->where('status', 'SUBMITTED')->count());
        $this->getJson("/api/v1/app/campaigns/{$cid}", $t['headers'])->assertOk()->assertJsonPath('data.campaign.dynamic.recipientColumn', 'Mobile Number')
            ->assertJsonMissingPath('data.campaign.dynamic.uploadId');
    }

    public function test_uploads_and_campaign_data_are_tenant_isolated(): void
    {
        $t = $this->tenant('100');
        $other = $this->tenant('100');
        $id = $this->upload($t)->json('data.id');
        $this->getJson("/api/v1/app/dynamic-sms/uploads/{$id}", $other['headers'])->assertStatus(404);
        $this->postJson('/api/v1/app/dynamic-sms/preview', $this->body($id), $other['headers'])->assertStatus(404);
        $this->postJson('/api/v1/app/dynamic-sms/submit', $this->body($id, ['confirmed' => true]), $other['headers'])->assertStatus(404);
        $this->getJson("/api/v1/app/dynamic-sms/uploads/{$id}", $t['headers'])->assertOk();
    }

    public function test_csv_values_cannot_inject_control_characters_and_exports_neutralise_formulas(): void
    {
        $this->assertSame('a b', DynamicSmsService::cleanValue("a\r\nb"));
        $t = $this->tenant('100');
        $id = $this->upload($t, "Name,Phone\n\"=HYPERLINK(1)\",01712345678\n")->json('data.id');
        $cid = $this->postJson('/api/v1/app/dynamic-sms/submit', $this->body($id, ['recipientColumn' => 'Phone', 'message' => '{{Name}}', 'confirmed' => true]), $t['headers'])->assertStatus(202)->json('data.id');
        $csv = $this->get("/api/v1/app/campaigns/{$cid}/export", $t['headers'])->assertOk()->streamedContent();
        $this->assertStringContainsString("\"'=HYPERLINK(1)\"", $csv);
    }

    public function test_template_download_is_utf8_with_bom(): void
    {
        $t = $this->tenant();
        $body = $this->get('/api/v1/app/dynamic-sms/template', $t['headers'])->assertOk()->getContent();
        $this->assertStringStartsWith("\u{FEFF}Retail Name,Mobile Number", $body);
    }
}
