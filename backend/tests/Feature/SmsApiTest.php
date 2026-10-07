<?php

namespace Tests\Feature;

use App\Models\ApiLog;
use App\Models\BlocklistEntry;
use App\Models\Message;
use App\Models\SenderId;
use App\Models\SuppressionEntry;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** The public SMS API contract (paths, auth, response shapes) and its money/compliance rules. */
class SmsApiTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private function at(string $time): void
    {
        // Outside promotional quiet hours (21:00–09:00 Dhaka) unless a test says otherwise.
        $this->travelTo(CarbonImmutable::parse($time, 'Asia/Dhaka'));
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->at('2026-10-07 12:00');
    }

    public function test_send_single_sms_charges_wallet_and_queues_message(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $res = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'Your OTP is 123456', 'reference' => 'order-1'], $k['headers']);

        $res->assertStatus(202)
            ->assertJsonPath('success', true)
            ->assertJsonPath('data.to', '+8801712345678')
            ->assertJsonPath('data.status', 'queued')
            ->assertJsonPath('data.segments', 1)
            ->assertJsonPath('data.encoding', 'GSM7')
            ->assertJsonPath('data.cost', '0.40')
            ->assertJsonPath('data.currency', 'BDT')
            ->assertJsonPath('data.scheduled_for', null);
        $this->assertMatchesRegularExpression('/^req_[A-Za-z0-9]{16}$/', $res->json('meta.requestId'));
        $m = Message::query()->findOrFail($res->json('data.message_id'));
        $this->assertSame('QUEUED', $m->status->value);
        $this->assertSame('API', $m->source->value);
        $this->assertSame('order-1', $m->clientReference);
        $this->assertSame('9.6000', $this->balance($t['org']));
        $this->assertSame(1, WalletTransaction::query()->where('organizationId', $t['org']->id)->where('reason', 'SMS_CHARGE')->count());
        // Every authenticated API request is logged (after the response).
        $this->assertSame(1, ApiLog::query()->where('apiKeyId', $k['id'])->where('statusCode', 202)->count());
    }

    public function test_bangla_message_is_ucs2_and_priced_per_segment(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '+8801812345678', 'message' => str_repeat('ক', 71)], $k['headers'])
            ->assertStatus(202)->assertJsonPath('data.encoding', 'UCS2')->assertJsonPath('data.segments', 2)->assertJsonPath('data.cost', '0.80');
    }

    public function test_insufficient_balance_is_402_and_nothing_is_created(): void
    {
        $t = $this->tenant('0.10');
        $k = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hi'], $k['headers'])
            ->assertStatus(402)->assertJsonPath('error.code', 'INSUFFICIENT_BALANCE')->assertJsonPath('error.details.required', '0.40');
        $this->assertSame(0, Message::query()->count());
        $this->assertSame('0.1000', $this->balance($t['org']));
    }

    public function test_validation_errors_and_strict_body(): void
    {
        $t = $this->tenant();
        $k = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678'], $k['headers'])
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_ERROR')->assertJsonPath('error.details.fields.0.path', 'message');
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x', 'callback' => 'x'], $k['headers'])->assertStatus(422);
        $this->postJson('/api/v1/sms/send', ['to' => '+14155550123', 'message' => 'x'], $k['headers'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_RECIPIENT');
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => str_repeat('a', 1531)], $k['headers'])->assertStatus(422)->assertJsonPath('error.code', 'MESSAGE_TOO_LONG');
    }

    public function test_api_key_errors(): void
    {
        $t = $this->tenant();
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'])->assertStatus(401)->assertJsonPath('error.code', 'INVALID_API_KEY');
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], ['Authorization' => 'Bearer sfk_live_nope_nope'])->assertStatus(401)->assertJsonPath('error.message', 'Invalid API key.');
        $readOnly = $this->apiKey($t['org'], ['balance:read']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $readOnly['headers'])->assertStatus(403)->assertJsonPath('error.code', 'INSUFFICIENT_SCOPE');
        $revoked = $this->apiKey($t['org'], ['sms:send'], ['status' => 'REVOKED']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $revoked['headers'])->assertStatus(401)->assertJsonPath('error.message', 'This API key has been revoked.');
        $expired = $this->apiKey($t['org'], ['sms:send'], ['expiresAt' => now()->subDay()]);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $expired['headers'])->assertStatus(401)->assertJsonPath('error.message', 'This API key has expired.');
        $ipLocked = $this->apiKey($t['org'], ['sms:send'], ['ipAllowlist' => ['203.0.113.9']]);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $ipLocked['headers'])->assertStatus(403)->assertJsonPath('error.code', 'FORBIDDEN');
        $t['org']->forceFill(['status' => 'SUSPENDED'])->save();
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $this->apiKey($t['org'])['headers'])->assertStatus(403)->assertJsonPath('error.message', 'This account is suspended.');
    }

    public function test_idempotency_key_replays_without_charging_twice(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $h = $k['headers'] + ['Idempotency-Key' => 'abc-123'];
        $first = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $h)->assertStatus(202);
        $second = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $h)->assertStatus(202)->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame($first->json('data.message_id'), $second->json('data.message_id'));
        $this->assertSame(1, Message::query()->count());
        $this->assertSame('9.6000', $this->balance($t['org']));
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'different'], $h)->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_CONFLICT');
    }

    public function test_failed_request_releases_the_idempotency_key(): void
    {
        $t = $this->tenant('0');
        $k = $this->apiKey($t['org']);
        $h = $k['headers'] + ['Idempotency-Key' => 'retry-after-topup'];
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $h)->assertStatus(402);
        Wallet::query()->where('organizationId', $t['org']->id)->update(['balance' => '5']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $h)->assertStatus(202);
    }

    public function test_bulk_send_reports_rejections_dedupes_and_charges_once(): void
    {
        $t = $this->tenant('100');
        $k = $this->apiKey($t['org']);
        BlocklistEntry::query()->forceCreate(['type' => 'NUMBER', 'value' => '+8801911111111']);
        $res = $this->postJson('/api/v1/sms/bulk', [
            'message' => 'Hi {{name}}',
            'recipients' => ['01712345678', '+8801712345678', 'bad', '01911111111', ['to' => '01812345678', 'variables' => ['name' => 'Karim']]],
        ], $k['headers']);
        $res->assertStatus(202)->assertJsonPath('data.accepted', 2)->assertJsonPath('data.rejected', 2)->assertJsonPath('data.total_cost', '0.80');
        $this->assertEqualsCanonicalizing(['bad', '+8801911111111'], array_column($res->json('data.errors'), 'to'));
        $this->assertSame('Hi Karim', Message::query()->where('to', '+8801812345678')->value('body'));
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'SMS_CHARGE')->count());
    }

    public function test_promotional_compliance_suppression_and_quiet_hours(): void
    {
        $t = $this->tenant('100');
        $k = $this->apiKey($t['org']);
        SuppressionEntry::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801712345678', 'reason' => 'OPT_OUT']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'Sale!', 'type' => 'promotional'], $k['headers'])->assertStatus(422)->assertJsonPath('error.code', 'RECIPIENT_SUPPRESSED');
        // Transactional messages still go to suppressed numbers (opt-out is for promotions).
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'Your OTP 1'], $k['headers'])->assertStatus(202);
        $this->at('2026-10-07 22:30');
        $this->postJson('/api/v1/sms/send', ['to' => '01812345678', 'message' => 'Sale!', 'type' => 'promotional'], $k['headers'])->assertStatus(422)->assertJsonPath('error.code', 'QUIET_HOURS');
    }

    public function test_sender_id_must_be_approved_and_default_is_used(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        SenderId::factory()->create(['organizationId' => $t['org']->id, 'value' => 'PENDINGCO']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x', 'sender_id' => 'PENDINGCO'], $k['headers'])->assertStatus(422)->assertJsonPath('error.code', 'SENDER_ID_NOT_APPROVED');
        SenderId::factory()->approved()->create(['organizationId' => $t['org']->id, 'value' => 'ACME', 'isDefault' => true]);
        $id = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $k['headers'])->assertStatus(202)->json('data.message_id');
        $m = Message::query()->findOrFail($id);
        $this->assertSame(['ACME', 'MASKING', '0.6000'], [$m->senderValue, $m->senderType->value, (string) $m->unitPrice]);
    }

    public function test_daily_limit_is_enforced(): void
    {
        $t = $this->tenant('100', 'OWNER', ['dailySendLimit' => 1]);
        $k = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'a'], $k['headers'])->assertStatus(202);
        $this->postJson('/api/v1/sms/send', ['to' => '01812345678', 'message' => 'b'], $k['headers'])->assertStatus(429)->assertJsonPath('error.code', 'DAILY_LIMIT_EXCEEDED');
    }

    public function test_scheduled_send(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $res = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'later', 'schedule_at' => '2026-10-08T10:00:00+06:00'], $k['headers'])->assertStatus(202);
        $this->assertSame('2026-10-08T04:00:00.000Z', $res->json('data.scheduled_for'));
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x', 'schedule_at' => '2027-01-01T10:00:00+06:00'], $k['headers'])->assertStatus(422);
    }

    public function test_estimate_messages_balance_and_sender_ids(): void
    {
        $t = $this->tenant('25');
        $k = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/estimate', ['message' => str_repeat('a', 161), 'recipients' => 100], $k['headers'])
            ->assertOk()->assertJsonPath('data.segments', 2)->assertJsonPath('data.estimated_cost', '80.00')->assertJsonPath('data.rate', '0.4000');
        $this->assertSame(0, Message::query()->count());

        $this->getJson('/api/v1/balance', $k['headers'])->assertOk()->assertJsonPath('data.balance', '25.0000')->assertJsonPath('data.rates.transactional.non_masking', '0.4000');

        $ids = [];
        foreach (['01712345671', '01712345672', '01712345673'] as $n) {
            $ids[] = $this->postJson('/api/v1/sms/send', ['to' => $n, 'message' => 'm'], $k['headers'])->json('data.message_id');
        }
        $page1 = $this->getJson('/api/v1/messages?limit=2', $k['headers'])->assertOk()->assertJsonPath('meta.hasMore', true);
        $this->assertCount(2, $page1->json('data'));
        $page2 = $this->getJson('/api/v1/messages?limit=2&cursor='.$page1->json('meta.nextCursor'), $k['headers'])->assertOk()->assertJsonPath('meta.hasMore', false);
        $this->assertCount(1, $page2->json('data'));
        $this->getJson("/api/v1/messages/{$ids[0]}", $k['headers'])->assertOk()->assertJsonPath('data.message_id', $ids[0])->assertJsonStructure(['data' => ['events']]);
        $this->getJson('/api/v1/messages/not-a-uuid', $k['headers'])->assertStatus(404);
        $this->getJson('/api/v1/messages?cursor=@@@', $k['headers'])->assertStatus(400)->assertJsonPath('error.code', 'INVALID_REQUEST');

        // Another tenant's key cannot read these messages.
        $other = $this->tenant();
        $this->getJson("/api/v1/messages/{$ids[0]}", $this->apiKey($other['org'])['headers'])->assertStatus(404);

        SenderId::factory()->approved()->create(['organizationId' => $t['org']->id, 'value' => 'ACME', 'isDefault' => true]);
        $this->getJson('/api/v1/sender-ids', $k['headers'])->assertOk()->assertJsonPath('data.0.sender_id', 'ACME')->assertJsonPath('data.0.default', true);
    }

    public function test_send_rate_limit_is_enforced_per_key(): void
    {
        config(['smsflow.rate_limits.api_send_per_key' => ['limit' => 1, 'window' => 60]]);
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'a'], $k['headers'])->assertStatus(202)->assertHeader('X-RateLimit-Limit', '1');
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'a'], $k['headers'])->assertStatus(429)->assertHeader('Retry-After');
    }
}
