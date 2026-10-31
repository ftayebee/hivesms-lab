<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\Message;
use App\Models\WalletTransaction;
use App\Services\Campaign\CampaignRunner;
use App\Services\Messaging\DispatcherService;
use App\Services\Messaging\WorkerService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * The mock SMS provider and mock payments are development tools. With APP_ENV=production they must
 * never run: no charge for an SMS that will not leave the platform, no fake "delivered" statuses,
 * no free wallet credit, and the readiness probe reports the misconfiguration.
 */
class ProductionSafeguardsTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
    }

    private function production(): void
    {
        $this->app['env'] = 'production';
        $this->assertTrue(app()->isProduction());
    }

    public function test_api_and_dashboard_sends_are_refused_before_charging(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $this->production();
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hi'], $k['headers'])
            ->assertStatus(503)->assertJsonPath('error.code', 'PROVIDER_NOT_CONFIGURED');
        $this->postJson('/api/v1/sms/bulk', ['recipients' => ['01712345678'], 'message' => 'hi'], $k['headers'])->assertStatus(503);
        $this->postJson('/api/v1/app/campaigns/submit', ['name' => 'x', 'smsType' => 'TRANSACTIONAL', 'message' => 'hi', 'numbers' => '01712345671', 'scheduleMode' => 'now'], $t['headers'])->assertStatus(503);
        $this->assertSame('10.0000', $this->balance($t['org']));
        $this->assertSame(0, Message::query()->count());
        $this->assertSame(0, WalletTransaction::query()->where('reason', 'SMS_CHARGE')->count());
    }

    public function test_worker_neither_sends_launches_nor_fakes_deliveries(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        // Queued (scheduled) message and a scheduled campaign created before the switch.
        $queued = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'later', 'schedule_at' => now()->addMinutes(5)->toIso8601String()], $k['headers'])->json('data.message_id');
        $sent = $this->postJson('/api/v1/sms/send', ['to' => '01712345679', 'message' => 'now'], $k['headers'])->json('data.message_id');
        app(DispatcherService::class)->processQueue();
        $this->assertSame('SUBMITTED', Message::query()->findOrFail($sent)->status->value);
        $campaignId = $this->postJson('/api/v1/app/campaigns/submit', ['name' => 'x', 'smsType' => 'TRANSACTIONAL', 'message' => 'hi', 'numbers' => '01712345671', 'scheduleMode' => 'later', 'scheduledAt' => now()->addMinutes(5)->toIso8601String()], $t['headers'])->assertStatus(202)->json('data.id');
        $balance = $this->balance($t['org']);

        $this->production();
        $this->travel(10)->minutes();
        $r = app(WorkerService::class)->tick();
        $this->assertSame([0, 0, 0, 0], [$r['campaignsLaunched'], $r['claimed'], $r['submitted'], $r['statusUpdates']]);
        $this->assertSame('QUEUED', Message::query()->findOrFail($queued)->status->value); // kept, not lost
        $this->assertSame('SUBMITTED', Message::query()->findOrFail($sent)->status->value); // never faked to DELIVERED
        $this->assertSame('SCHEDULED', Campaign::query()->findOrFail($campaignId)->status->value);
        $this->assertFalse(app(CampaignRunner::class)->launch($campaignId)['launched']);
        $this->assertSame($balance, $this->balance($t['org']));
        $this->assertSame(['checked' => 0, 'updated' => 0], app(DispatcherService::class)->pollDeliveryStatuses());
    }

    public function test_mock_payments_cannot_credit_the_wallet(): void
    {
        $t = $this->tenant('0');
        $id = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->assertCreated()->json('data.payment.id');
        $this->production();
        $this->postJson("/api/v1/app/payments/{$id}/mock-complete", ['outcome' => 'success'], $t['headers'])->assertStatus(403);
        $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $t['headers'])->assertStatus(422);
        $this->getJson('/api/v1/app/payments/methods', $t['headers'])->assertOk()->assertJsonMissing(['key' => 'mock']);
        $this->assertSame('0.0000', $this->balance($t['org']));
    }

    public function test_readiness_fails_in_production_with_mock_provider_and_no_scheduler(): void
    {
        $this->production();
        $res = $this->getJson('/api/v1/internal/ready', ['Authorization' => 'Bearer '.config('smsflow.cron_secret')])->assertStatus(503);
        $this->assertSame('fail', $res->json('error.details.checks.smsProvider'));
        $this->assertSame('fail', $res->json('error.details.checks.scheduler'));
        $this->assertSame('fail', $res->json('error.details.checks.smsWebhookSecret'));
        $this->assertStringNotContainsString((string) config('smsflow.cron_secret'), $res->getContent());
    }

    public function test_readiness_is_green_outside_production_after_a_worker_tick(): void
    {
        app(WorkerService::class)->tick();
        $this->getJson('/api/v1/internal/ready', ['Authorization' => 'Bearer '.config('smsflow.cron_secret')])
            ->assertOk()->assertJsonPath('data.checks.scheduler', 'ok')->assertJsonPath('data.checks.smsProvider', 'ok');
        $this->getJson('/api/v1/internal/ready', ['Authorization' => 'Bearer wrong'])->assertStatus(401);
    }
}
