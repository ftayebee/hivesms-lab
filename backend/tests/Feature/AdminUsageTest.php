<?php

namespace Tests\Feature;

use App\Models\Message;
use App\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class AdminUsageTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private function message(Organization $org, string $status, array $attrs = []): void
    {
        Message::query()->forceCreate($attrs + [
            'organizationId' => $org->id, 'source' => 'API', 'to' => '+8801712345678', 'senderValue' => 'BRAND', 'senderType' => 'MASKING',
            'smsType' => 'TRANSACTIONAL', 'body' => 'secret text', 'encoding' => 'GSM7', 'segments' => 2, 'unitPrice' => '0.5', 'cost' => '1', 'status' => $status,
        ]);
    }

    public function test_ranks_customers_by_usage_and_shows_inactive_ones(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-20 12:00', 'Asia/Dhaka'));
        $busy = $this->tenant('10', 'OWNER', ['name' => 'Busy Ltd'])['org'];
        $quiet = $this->tenant('10', 'OWNER', ['name' => 'Quiet Ltd'])['org'];
        $this->message($busy, 'DELIVERED');
        $this->message($busy, 'SUBMITTED');
        $this->message($busy, 'FAILED', ['refundedAt' => now()]);

        $res = $this->getJson('/api/v1/admin/usage?range=7d', $this->staff('SUPPORT'))->assertOk();

        $res->assertJsonPath('data.0.name', 'Busy Ltd')
            ->assertJsonPath('data.0.messages', 3)
            ->assertJsonPath('data.0.segments', 6)
            ->assertJsonPath('data.0.delivered', 1)
            ->assertJsonPath('data.0.pending', 1)
            ->assertJsonPath('data.0.failed', 1)
            ->assertJsonPath('data.0.charged', '2.0000')
            ->assertJsonPath('data.1.name', 'Quiet Ltd')
            ->assertJsonPath('data.1.messages', 0)
            ->assertJsonPath('meta.totals.messages', 3)
            ->assertJsonPath('meta.activeCustomers', 1)
            ->assertJsonCount(7, 'meta.series');
        $this->assertSame(1, $res->json('meta.series.6.delivered'));
        $this->assertSame('2026-10-20', $res->json('meta.series.6.day'));
        $this->assertStringNotContainsString('secret text', $res->getContent());
        $this->assertStringNotContainsString('8801712345678', $res->getContent());

        $this->getJson('/api/v1/admin/usage?q=Quiet', $this->staff('SUPPORT'))->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('meta.total', 1);
        $this->assertNotNull($quiet);
    }

    public function test_shows_one_customers_daily_usage_and_breakdowns(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-20 12:00', 'Asia/Dhaka'));
        $org = $this->tenant()['org'];
        $other = $this->tenant()['org'];
        $this->message($org, 'DELIVERED');
        $this->message($org, 'DELIVERED', ['source' => 'CAMPAIGN', 'smsType' => 'PROMOTIONAL']);
        $this->message($other, 'DELIVERED');

        $res = $this->getJson("/api/v1/admin/customers/{$org->id}/usage?range=7d", $this->staff('ADMIN'))->assertOk();

        $res->assertJsonPath('data.totals.messages', 2)
            ->assertJsonPath('data.bySource.API', 1)
            ->assertJsonPath('data.bySource.CAMPAIGN', 1)
            ->assertJsonPath('data.byType.PROMOTIONAL', 1)
            ->assertJsonCount(7, 'data.series');
        $this->getJson('/api/v1/admin/customers/00000000-0000-0000-0000-000000000000/usage', $this->staff('ADMIN'))->assertNotFound();
    }

    public function test_is_staff_only(): void
    {
        $t = $this->tenant();
        $this->getJson('/api/v1/admin/usage')->assertUnauthorized();
        $this->getJson('/api/v1/admin/usage', $t['headers'])->assertForbidden();
        $this->getJson("/api/v1/admin/customers/{$t['org']->id}/usage", $t['headers'])->assertForbidden();
    }
}
