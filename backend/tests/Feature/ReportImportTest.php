<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Message;
use App\Models\ReportImport;
use App\Models\WalletTransaction;
use App\Services\Report\ReportImportService;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Admin SMS report import (docs/24). */
class ReportImportTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const PW = UserFactory::PASSWORD;

    protected function setUp(): void
    {
        parent::setUp();
        config(['smsflow.features.report_import' => true]);
        Mail::fake();
    }

    private function csv(string $body, string $name = 'report.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "\u{FEFF}Sender ID,Mobile Number,Message,Sent At,Status,SMS Type,Delivered At,Error,Reference,Cost\r\n".$body);
    }

    private function sample(): string
    {
        return "MZSMS,01712345678,Hello there,2026-11-20 10:15:00,Delivered,Transactional,2026-11-20 10:15:07,,ORD-1,\r\n"
            ."8809601000000,+8801812345678,Eid offer,20/11/2026 4:30 PM,Sent,Promotional,,,,0.35\r\n"
            ."MZSMS,01912345678,আপনার অর্ডার পাঠানো হয়েছে,2026-11-21 09:00,Failed,,,Handset unreachable,,\r\n"
            ."MZSMS,12345,Bad number,2026-11-21 09:00,Delivered,,,,,\r\n"
            ."MZSMS,01512345678,Bad time,yesterday,Delivered,,,,,\r\n"
            ."MZSMS,01612345678,Bad status,2026-11-21 09:00,Queued,,,,,\r\n";
    }

    public function test_template_preview_and_import_with_wallet_charge(): void
    {
        $sa = $this->staff('SUPER_ADMIN');
        $t = $this->tenant('100');
        $orgId = $t['org']->id;

        $tpl = $this->get('/api/v1/admin/report-imports/template', $sa)->assertOk();
        $this->assertStringContainsString('Sender ID,', str_replace('"', '', $tpl->getContent()));

        $preview = $this->post('/api/v1/admin/report-imports/preview', ['organizationId' => $orgId, 'file' => $this->csv($this->sample())], $sa + ['Accept' => 'application/json'])
            ->assertOk()->json('data');
        $this->assertSame([6, 3, 3], [$preview['rowCount'], $preview['valid'], $preview['skipped']]);
        $this->assertSame([5, 6, 7], array_column($preview['errors'], 'line')); // header is line 1
        $this->assertNull($preview['alreadyImported']);
        $this->assertSame(['DELIVERED' => 1, 'SUBMITTED' => 1, 'FAILED' => 1], $preview['byStatus']);
        // Row 2 has its own cost; the failed row costs nothing while failed messages are refunded.
        $this->assertSame('0.3500', $preview['rows'][1]['cost']);
        $this->assertSame('0.0000', $preview['rows'][2]['cost']);
        $this->assertSame('2026-11-20T10:30:00.000Z', $preview['rows'][1]['sentAt']); // 4:30 PM Dhaka
        $this->assertSame(0, Message::query()->count(), 'preview writes nothing');

        // Wrong password → nothing imported.
        $this->post('/api/v1/admin/report-imports', ['organizationId' => $orgId, 'file' => $this->csv($this->sample()), 'chargeWallet' => '1', 'currentPassword' => 'wrong'], $sa + ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('error.details.field', 'currentPassword');
        $this->assertSame(0, Message::query()->count());

        $res = $this->post('/api/v1/admin/report-imports', ['organizationId' => $orgId, 'file' => $this->csv($this->sample()), 'chargeWallet' => '1', 'note' => 'Old panel', 'currentPassword' => self::PW], $sa + ['Accept' => 'application/json'])
            ->assertCreated()->json('data');
        $this->assertSame([3, 3, true], [$res['import']['importedCount'], $res['import']['skippedCount'], $res['import']['charged']]);

        $messages = Message::query()->where('organizationId', $orgId)->orderBy('createdAt')->get();
        $this->assertCount(3, $messages);
        $this->assertSame(['IMPORT'], $messages->pluck('source')->map->value->unique()->values()->all());
        $this->assertNotContains('QUEUED', $messages->pluck('status')->map->value->all());
        $this->assertSame('+8801712345678', $messages[0]->to);
        $this->assertSame('MASKING', $messages[0]->senderType->value);
        $this->assertSame('NON_MASKING', $messages[1]->senderType->value);
        $this->assertSame('2026-11-20 04:15:00', $messages[0]->createdAt->utc()->format('Y-m-d H:i:s'));
        $this->assertSame(3, \DB::table('message_events')->whereIn('messageId', $messages->pluck('id'))->count());

        $total = (string) $res['import']['totalCost'];
        $tx = WalletTransaction::query()->where('referenceType', 'report_import')->firstOrFail();
        $this->assertSame(['DEBIT', 'SMS_CHARGE'], [$tx->type->value, $tx->reason->value]);
        $this->assertEquals((float) $total, (float) $tx->amount);
        $this->assertEquals(100 - (float) $total, (float) $this->balance($t['org']));
        $this->assertTrue(AuditLog::query()->where('action', 'admin.report.import')->exists());

        // Shows up in the customer's reports with the IMPORT source filter.
        $this->getJson('/api/v1/app/reports/messages?range=custom&from=2026-11-01&to=2026-11-30&source=IMPORT', $t['headers'])->assertOk()->assertJsonCount(3, 'data');

        // The same file cannot be imported twice.
        $this->post('/api/v1/admin/report-imports', ['organizationId' => $orgId, 'file' => $this->csv($this->sample()), 'chargeWallet' => '1', 'currentPassword' => self::PW], $sa + ['Accept' => 'application/json'])
            ->assertStatus(409);
        $this->assertSame(3, Message::query()->count());

        $this->getJson('/api/v1/admin/report-imports', $sa)->assertOk()->assertJsonPath('data.0.note', 'Old panel');
    }

    public function test_insufficient_balance_rolls_back_and_no_charge_imports(): void
    {
        $sa = $this->staff('SUPER_ADMIN');
        $t = $this->tenant('0');
        $file = fn () => $this->csv("MZSMS,01712345678,Hello,2026-11-20 10:15,Delivered,,,,,5\r\n");

        $this->post('/api/v1/admin/report-imports', ['organizationId' => $t['org']->id, 'file' => $file(), 'chargeWallet' => '1', 'currentPassword' => self::PW], $sa + ['Accept' => 'application/json'])
            ->assertStatus(402);
        $this->assertSame([0, 0], [Message::query()->count(), ReportImport::query()->count()]);

        $this->post('/api/v1/admin/report-imports', ['organizationId' => $t['org']->id, 'file' => $file(), 'chargeWallet' => '0', 'currentPassword' => self::PW], $sa + ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonPath('data.import.charged', false);
        $this->assertSame(1, Message::query()->count());
        $this->assertSame(0, WalletTransaction::query()->where('referenceType', 'report_import')->count());
    }

    public function test_access_feature_switch_and_missing_columns(): void
    {
        $t = $this->tenant();
        $this->getJson('/api/v1/admin/report-imports', $this->staff('ADMIN'))->assertForbidden();
        $this->getJson('/api/v1/admin/report-imports', $t['headers'])->assertForbidden();

        $sa = $this->staff('SUPER_ADMIN');
        $bad = UploadedFile::fake()->createWithContent('r.csv', "Phone,Text\r\n01712345678,Hi\r\n");
        $this->post('/api/v1/admin/report-imports/preview', ['organizationId' => $t['org']->id, 'file' => $bad], $sa + ['Accept' => 'application/json'])
            ->assertStatus(422)->assertJsonPath('error.message', 'The file is missing the columns Sender ID, Sent At. Download the template to see the expected columns.');

        config(['smsflow.features.report_import' => false]);
        $this->getJson('/api/v1/admin/report-imports', $sa)->assertStatus(403)->assertJsonPath('error.code', 'FEATURE_DISABLED');
    }

    public function test_time_and_status_parsing(): void
    {
        $iso = fn (string $v) => ReportImportService::parseTime($v)?->format('Y-m-d H:i:s');
        $this->assertSame('2026-11-20 08:30:00', $iso('2026-11-20 14:30'));
        $this->assertSame('2026-11-20 08:30:00', $iso('20/11/2026 2:30 pm'));
        $this->assertSame('2026-02-01 03:05:00', $iso('1/2/2026 9:05'));
        $this->assertSame('2026-11-20 14:30:00', $iso('2026-11-20T14:30:00Z'));
        $this->assertSame('2026-11-20 08:30:00', $iso('20 Nov 2026 14:30'));
        $this->assertNull($iso('31/02/2026 10:00'));
        $this->assertNull($iso('soon'));
        $this->assertSame('DELIVERED', ReportImportService::parseStatus(''));
        $this->assertSame('SUBMITTED', ReportImportService::parseStatus('Sent'));
        $this->assertSame('FAILED', ReportImportService::parseStatus('UNDELIVERED'));
        $this->assertNull(ReportImportService::parseStatus('Queued'));
    }
}
