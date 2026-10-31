<?php

namespace Tests\Feature;

use App\Models\Message;
use App\Models\WalletTransaction;
use App\Services\Messaging\DispatcherService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\Providers\HttpSmsProvider;
use App\Services\Sms\Providers\MockSmsProvider;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SendSmsResult;
use App\Services\Sms\SmsProviderManager;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * Duplicate-SMS protection: a message is resent only when it certainly never reached the
 * provider. Ambiguous outcomes (read timeout, 5xx after receipt, worker crash mid-send) are closed
 * as FAILED + refunded and never resent.
 */
class DuplicateSendTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
    }

    /** @return array{0: array, 1: string} */
    private function queued(string $balance = '10'): array
    {
        $t = $this->tenant($balance);
        $k = $this->apiKey($t['org']);
        // Keep it queued: inline dispatch happens in the request, so send while sending is held off.
        $id = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello', 'schedule_at' => now()->addMinutes(5)->toIso8601String()], $k['headers'])->assertStatus(202)->json('data.message_id');
        $this->travel(6)->minutes();

        return [$t, $id];
    }

    private function useHttpProvider(): void
    {
        config(['smsflow.sms.provider' => 'http', 'smsflow.sms.provider_url' => 'https://gateway.invalid/send', 'smsflow.sms.provider_api_key' => 'test-key']);
        app(SettingsService::class)->clearCache();
    }

    private function sendCount(): int
    {
        return count(Http::recorded(fn (Request $r) => str_starts_with($r->url(), 'https://gateway.invalid/')));
    }

    public function test_connection_errors_are_classified_by_whether_the_request_left(): void
    {
        foreach (['cURL error 6: Could not resolve host: gateway.invalid', 'cURL error 7: Failed to connect to x port 443', 'Connection refused', 'cURL error 28: Connection timed out after 5001 milliseconds', 'Resolving timed out after 5000 milliseconds'] as $m) {
            $r = HttpSmsProvider::classifyConnectionError($m);
            $this->assertTrue($r->retryable && ! $r->unconfirmed, $m);
        }
        foreach (['cURL error 28: Operation timed out after 15000 milliseconds with 0 bytes received', 'cURL error 52: Empty reply from server', 'cURL error 56: Recv failure: Connection reset by peer', ''] as $m) {
            $r = HttpSmsProvider::classifyConnectionError($m);
            $this->assertTrue($r->unconfirmed && ! $r->retryable && ! $r->ok, $m);
        }
    }

    public function test_provider_5xx_after_receipt_is_failed_refunded_and_never_resent(): void
    {
        $this->useHttpProvider();
        Http::fake(['gateway.invalid/*' => Http::response('Internal Server Error', 500)]);
        [$t, $id] = $this->queued();
        app(DispatcherService::class)->processQueue();
        $m = Message::query()->findOrFail($id);
        $this->assertSame(['FAILED', 'HTTP_500'], [$m->status->value, $m->errorCode]);
        $this->assertNotNull($m->refundedAt);
        $this->assertSame('10.0000', $this->balance($t['org']));
        // Later ticks never send it again.
        $this->travel(2)->hours();
        app(DispatcherService::class)->processQueue();
        $this->assertSame(1, $this->sendCount());
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'REFUND')->count());
    }

    public function test_read_timeout_is_failed_and_never_resent(): void
    {
        $this->useHttpProvider();
        Http::fake(['gateway.invalid/*' => Http::failedConnection('cURL error 28: Operation timed out after 15000 milliseconds with 0 bytes received')]);
        [, $id] = $this->queued();
        app(DispatcherService::class)->processQueue();
        $this->assertSame(['FAILED', 'PROVIDER_TIMEOUT'], [Message::query()->findOrFail($id)->status->value, Message::query()->findOrFail($id)->errorCode]);
        $this->travel(2)->hours();
        app(DispatcherService::class)->processQueue();
        $m = Message::query()->findOrFail($id);
        $this->assertSame(['FAILED', 1], [$m->status->value, $m->attempts]); // never claimed again
    }

    public function test_connect_failure_never_reached_the_provider_and_is_retried(): void
    {
        $this->useHttpProvider();
        Http::fake(['gateway.invalid/*' => Http::failedConnection('cURL error 7: Failed to connect to gateway.invalid port 443')]);
        [, $id2] = $this->queued();
        app(DispatcherService::class)->processQueue();
        $m = Message::query()->findOrFail($id2);
        $this->assertSame(['QUEUED', 'NETWORK_ERROR', null], [$m->status->value, $m->errorCode, $m->provider]); // never reached the provider: retried
    }

    public function test_503_and_429_are_retried_and_success_after_retry_is_sent_once(): void
    {
        $this->useHttpProvider();
        Http::fakeSequence('gateway.invalid/*')
            ->push('busy', 503)
            ->push(['error' => 0, 'data' => ['request_id' => 'gw-1']], 200);
        [, $id] = $this->queued();
        app(DispatcherService::class)->processQueue();
        $this->assertSame('QUEUED', Message::query()->findOrFail($id)->status->value);
        $this->travel(5)->minutes();
        app(DispatcherService::class)->processQueue();
        $m = Message::query()->findOrFail($id);
        $this->assertSame(['SUBMITTED', 'gw-1', 2], [$m->status->value, $m->providerMessageId, $m->attempts]);
        $this->assertSame(2, $this->sendCount());
    }

    public function test_worker_crash_after_marking_in_flight_is_closed_without_resend(): void
    {
        [$t, $id] = $this->queued();
        $counting = new class('') extends MockSmsProvider
        {
            public int $count = 0;

            public function send(SendSmsInput $input): SendSmsResult
            {
                $this->count++;

                return parent::send($input);
            }
        };
        app(SmsProviderManager::class)->fake('mock', $counting);
        // Simulate: claimed, in-flight marker written, then the process died before recording the answer.
        $ids = app(DispatcherService::class)->claim(10);
        $this->assertSame([$id], $ids);
        Message::query()->whereKey($id)->update(['provider' => 'mock']);
        $this->travel(10)->minutes(); // lease expired
        app(DispatcherService::class)->processQueue();
        $m = Message::query()->findOrFail($id);
        $this->assertSame(['FAILED', 'SEND_INTERRUPTED'], [$m->status->value, $m->errorCode]);
        $this->assertSame(0, $counting->count);
        $this->assertSame('10.0000', $this->balance($t['org']));
    }

    public function test_lease_expired_before_the_marker_is_safely_retried(): void
    {
        [, $id] = $this->queued();
        app(DispatcherService::class)->claim(10); // claimed, crashed before calling the provider
        $this->travel(10)->minutes();
        $r = app(DispatcherService::class)->processQueue();
        $this->assertSame(1, $r['submitted']);
        $this->assertSame('SUBMITTED', Message::query()->findOrFail($id)->status->value);
    }
}
