<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\Message;
use App\Models\MessageEvent;
use App\Models\SuppressionEntry;
use App\Models\WalletTransaction;
use App\Services\Messaging\DispatcherService;
use App\Services\Sms\Providers\MockSmsProvider;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SendSmsResult;
use App\Services\Sms\SmsProviderManager;
use App\Support\Crypto;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Dispatch, retries, refunds, delivery reports (poll + signed webhooks), idempotency. */
class DeliveryAndWebhookTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
    }

    /** @return array{0: array, 1: string} tenant + message id */
    private function queued(string $to = '01712345678', string $balance = '10'): array
    {
        $t = $this->tenant($balance);
        $k = $this->apiKey($t['org']);
        $id = $this->postJson('/api/v1/sms/send', ['to' => $to, 'message' => 'hello'], $k['headers'])->assertStatus(202)->json('data.message_id');

        return [$t, $id];
    }

    private function dispatcher(): DispatcherService
    {
        return app(DispatcherService::class);
    }

    public function test_dispatch_submits_and_poll_delivers(): void
    {
        [$t, $id] = $this->queued();
        $r = $this->dispatcher()->processQueue();
        $this->assertSame(1, $r['claimed']);
        $this->assertSame(1, $r['submitted']);
        $m = Message::query()->findOrFail($id);
        $this->assertSame('SUBMITTED', $m->status->value);
        $this->assertSame('mock', $m->provider);
        $this->assertStringStartsWith('mock_d_', $m->providerMessageId);

        // A second worker finds nothing to claim: the message is never sent twice.
        $this->assertSame(0, $this->dispatcher()->processQueue()['claimed']);

        $this->travel(10)->seconds();
        $this->dispatcher()->pollDeliveryStatuses();
        $this->assertSame('DELIVERED', $m->refresh()->status->value);
        $this->assertNotNull($m->deliveredAt);
    }

    public function test_rejected_message_is_refunded_once(): void
    {
        [$t, $id] = $this->queued('01712340000');
        $this->dispatcher()->processQueue();
        $m = Message::query()->findOrFail($id);
        $this->assertSame('REJECTED', $m->status->value);
        $this->assertNotNull($m->refundedAt);
        $this->assertSame('10.0000', $this->balance($t['org']));
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'REFUND')->count());
    }

    public function test_transient_failures_retry_with_backoff_then_fail_and_refund(): void
    {
        [$t, $id] = $this->queued('01712348888');
        $this->dispatcher()->processQueue();
        $m = Message::query()->findOrFail($id);
        $this->assertSame('QUEUED', $m->status->value);
        $this->assertSame(1, $m->attempts);
        $this->assertTrue($m->nextAttemptAt->isFuture());
        for ($i = 0; $i < 6; $i++) {
            $this->travel(31)->minutes();
            $this->dispatcher()->processQueue();
        }
        $m->refresh();
        $this->assertSame('FAILED', $m->status->value);
        $this->assertSame(4, $m->attempts); // policy maxAttempts: never retried forever
        $this->assertStringContainsString('gave up after 4 attempts', $m->errorMessage);
        $this->assertSame('10.0000', $this->balance($t['org']));
    }

    public function test_messages_of_suspended_organizations_are_held(): void
    {
        [$t, $id] = $this->queued();
        $t['org']->forceFill(['status' => 'SUSPENDED'])->save();
        $this->assertSame(0, $this->dispatcher()->processQueue()['claimed']);
        $this->assertSame('QUEUED', Message::query()->findOrFail($id)->status->value);
    }

    public function test_provider_exception_path_uses_injected_provider(): void
    {
        [$t, $id] = $this->queued();
        $failing = new class extends MockSmsProvider
        {
            public function send(SendSmsInput $input): SendSmsResult
            {
                return SendSmsResult::failed(false, 'BLOCKED', 'Operator blocked this sender.');
            }
        };
        app(SmsProviderManager::class)->fake('mock', $failing);
        $this->dispatcher()->processQueue();
        $m = Message::query()->findOrFail($id);
        $this->assertSame(['REJECTED', 'BLOCKED', 'Operator blocked this sender.'], [$m->status->value, $m->errorCode, $m->errorMessage]);
    }

    private function webhook(array $payload, ?string $secret = 'whsec-test'): TestResponse
    {
        $body = json_encode($payload);
        $headers = ['CONTENT_TYPE' => 'application/json'];
        if ($secret !== null) {
            $headers['HTTP_X_SIGNATURE'] = Crypto::hmacSha256($secret, $body);
        }

        return $this->call('POST', '/api/v1/webhooks/sms/mock', [], [], [], $headers, $body);
    }

    public function test_signed_delivery_webhook_is_applied_once_and_never_double_counted(): void
    {
        config(['smsflow.sms.provider_webhook_secret' => 'whsec-test']);
        $t = $this->tenant('10');
        // A campaign message, to also check campaign counters.
        $c = Campaign::query()->forceCreate([
            'organizationId' => $t['org']->id, 'name' => 'C', 'smsType' => 'TRANSACTIONAL', 'senderValue' => '8809600000000', 'senderType' => 'NON_MASKING',
            'message' => 'm', 'encoding' => 'GSM7', 'segmentsPerMessage' => 1, 'status' => 'PROCESSING', 'queuedCount' => 1,
        ]);
        $k = $this->apiKey($t['org']);
        $id = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $k['headers'])->json('data.message_id');
        Message::query()->whereKey($id)->update(['campaignId' => $c->id]);
        $this->dispatcher()->processQueue();
        $pmid = Message::query()->whereKey($id)->value('providerMessageId');
        $payload = ['events' => [['message_id' => $pmid, 'status' => 'DELIVRD', 'timestamp' => '2026-10-07T06:00:05Z']]];

        $this->webhook($payload)->assertOk()->assertJsonPath('applied', 1);
        $this->webhook($payload)->assertOk()->assertJsonPath('applied', 0); // replay: ignored
        $this->assertSame('DELIVERED', Message::query()->findOrFail($id)->status->value);
        $c->refresh();
        $this->assertSame([1, 1, 0, 0], [$c->submittedCount, $c->deliveredCount, $c->failedCount, $c->queuedCount]);

        // A late "failed" report cannot overwrite a final status.
        $this->webhook(['events' => [['message_id' => $pmid, 'status' => 'UNDELIV', 'timestamp' => '2026-10-07T07:00:00Z']]])->assertOk()->assertJsonPath('applied', 0);
        $this->assertSame('DELIVERED', Message::query()->findOrFail($id)->status->value);
        $this->assertSame(0, WalletTransaction::query()->where('reason', 'REFUND')->count());
        $this->assertSame(3, MessageEvent::query()->where('messageId', $id)->count()); // submit, delivered, stale failed (recorded)
    }

    public function test_invalid_or_missing_signature_is_rejected(): void
    {
        config(['smsflow.sms.provider_webhook_secret' => 'whsec-test']);
        $this->webhook(['events' => []], 'wrong-secret')->assertStatus(401);
        $this->webhook(['events' => []], null)->assertStatus(401);
        $this->call('POST', '/api/v1/webhooks/sms/unknown', [], [], [], ['CONTENT_TYPE' => 'application/json'], '{}')->assertStatus(404);
    }

    public function test_failed_delivery_report_refunds_per_policy(): void
    {
        config(['smsflow.sms.provider_webhook_secret' => 'whsec-test']);
        [$t, $id] = $this->queued();
        $this->dispatcher()->processQueue();
        $pmid = Message::query()->whereKey($id)->value('providerMessageId');
        $this->webhook(['events' => [['message_id' => $pmid, 'status' => 'UNDELIV', 'error_code' => 'E1', 'description' => 'Absent subscriber']]])->assertOk();
        $m = Message::query()->findOrFail($id);
        $this->assertSame(['FAILED', 'E1', 'Absent subscriber'], [$m->status->value, $m->errorCode, $m->errorMessage]);
        $this->assertSame('10.0000', $this->balance($t['org']));
    }

    public function test_inbound_stop_suppresses_the_number_for_senders(): void
    {
        config(['smsflow.sms.provider_webhook_secret' => 'whsec-test']);
        [$t] = $this->queued('01712345678');
        $body = json_encode(['messages' => [['id' => 'in-1', 'from' => '8801712345678', 'to' => '16000', 'text' => 'stop please']]]);
        $this->call('POST', '/api/v1/webhooks/sms/mock/inbound', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_SIGNATURE' => Crypto::hmacSha256('whsec-test', $body)], $body)
            ->assertOk()->assertJsonPath('optOuts', 1);
        $this->assertTrue(SuppressionEntry::query()->where('organizationId', $t['org']->id)->where('phone', '+8801712345678')->where('reason', 'OPT_OUT')->exists());
    }

    public function test_worker_command_runs_a_full_cycle(): void
    {
        [$t, $id] = $this->queued();
        $this->artisan('sms:work', ['--budget' => 5])->assertSuccessful();
        $this->assertSame('SUBMITTED', Message::query()->findOrFail($id)->status->value);
    }

    public function test_cron_endpoint_requires_the_secret(): void
    {
        $this->postJson('/api/v1/internal/worker/tick')->assertStatus(401);
        $this->postJson('/api/v1/internal/worker/tick', [], ['Authorization' => 'Bearer test-cron-secret-0123456789'])->assertOk()->assertJsonPath('ok', true);
    }
}
