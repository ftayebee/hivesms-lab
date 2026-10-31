<?php

namespace Tests\Feature;

use App\Models\Message;
use App\Services\Messaging\DispatcherService;
use App\Services\Platform\SettingsService;
use App\Services\Sms\Providers\AutomasSmsProvider;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SmsProviderManager;
use App\Services\Sms\WebhookRequest;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class AutomasProviderTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const URL = 'api.automas.com.bd/*';

    private function provider(string $key = 'k'): AutomasSmsProvider
    {
        return new AutomasSmsProvider($key);
    }

    private function input(string $to = '+8801712345678', string $message = 'Hello', string $encoding = 'GSM7'): SendSmsInput
    {
        return new SendSmsInput('r1', $to, $message, 'BRAND', 'MASKING', 'TRANSACTIONAL', $encoding);
    }

    /** @param array<string, mixed> $entry */
    private function reply(array $entry): void
    {
        Http::fake([self::URL => Http::response(['response' => [$entry]])]);
    }

    public function test_form_posts_the_documented_parameters_and_keeps_the_key_out_of_the_url(): void
    {
        $this->reply(['status' => 0, 'id' => 296334, 'msisdn' => '8801712345678']);
        $r = $this->provider()->send($this->input());
        $this->assertTrue($r->ok);
        $this->assertSame('296334', $r->providerMessageId);
        Http::assertSent(fn (Request $q) => $q->url() === 'https://api.automas.com.bd/smsapiv3' && $q->isForm()
            && $q->data() === ['apikey' => 'k', 'sender' => 'BRAND', 'msisdn' => '8801712345678', 'smstext' => 'Hello']);
    }

    public function test_sets_the_unicode_flags_for_bangla_and_sends_the_text_intact(): void
    {
        $this->reply(['status' => 0, 'id' => 1]);
        $this->provider()->send($this->input(message: 'পরীক্ষা', encoding: 'UCS2'));
        Http::assertSent(fn (Request $q) => $q['smstext'] === 'পরীক্ষা' && ! isset($q['type']) && $q['smsformat'] === '8');
    }

    public function test_marks_multi_part_messages_as_long(): void
    {
        $this->reply(['status' => 0, 'id' => 1]);
        $this->provider()->send($this->input(message: str_repeat('a', 161)));
        Http::assertSent(fn (Request $q) => $q['type'] === 'long' && ! isset($q['smsformat']));

        Http::swap(new Factory);
        $this->reply(['status' => 0, 'id' => 1]);
        $this->provider()->send($this->input(message: str_repeat('প', 71), encoding: 'UCS2'));
        Http::assertSent(fn (Request $q) => $q['type'] === 'long' && $q['smsformat'] === '8');

        Http::swap(new Factory);
        $this->reply(['status' => 0, 'id' => 1]);
        $this->provider()->send($this->input(message: str_repeat('a', 160)));
        Http::assertSent(fn (Request $q) => ! isset($q['type']));
    }

    public function test_does_not_mistake_a_failed_send_for_success_even_though_it_carries_an_id(): void
    {
        // Recorded from the live API with a deliberately invalid key.
        Http::fake([self::URL => Http::response('{"response":[{"status":106,"id":165804,"msisdn":"8801700000000"}]}')]);
        $r = $this->provider()->send($this->input('+8801700000000'));
        $this->assertFalse($r->ok);
        $this->assertTrue($r->retryable);
        $this->assertSame('AUTOMAS_106', $r->errorCode);
    }

    public function test_message_faults_are_final_and_account_problems_retry(): void
    {
        foreach ([101, 102, 105, 110, 111] as $status) {
            Http::swap(new Factory);
            $this->reply(['status' => $status, 'id' => 1]);
            $r = $this->provider()->send($this->input());
            $this->assertTrue(! $r->ok && ! $r->retryable && ! $r->unconfirmed, "status {$status}");
            $this->assertSame("AUTOMAS_{$status}", $r->errorCode);
        }
        foreach ([103, 104, 106, 107, 108, 109, 1000, 2000, 2300, 2400, 3000, 3300, 4000] as $status) {
            Http::swap(new Factory);
            $this->reply(['status' => $status, 'id' => 1]);
            $r = $this->provider()->send($this->input());
            $this->assertTrue(! $r->ok && $r->retryable, "status {$status}");
        }
    }

    public function test_accepts_a_numeric_status_sent_as_a_string(): void
    {
        $this->reply(['status' => '0', 'id' => 7]);
        $r = $this->provider()->send($this->input());
        $this->assertTrue($r->ok);
        $this->assertSame('7', $r->providerMessageId);
    }

    public function test_undocumented_statuses_and_unreadable_replies_are_never_resent(): void
    {
        foreach ([Http::response(['response' => [['status' => 9999, 'id' => 1]]]), Http::response('<html>oops</html>'), Http::response('[]'), Http::response('Internal Server Error', 500)] as $reply) {
            Http::swap(new Factory);
            Http::fake([self::URL => $reply]);
            $r = $this->provider()->send($this->input());
            $this->assertTrue(! $r->ok && $r->unconfirmed && ! $r->retryable);
        }
    }

    public function test_retries_only_when_the_message_certainly_did_not_arrive(): void
    {
        Http::fake([self::URL => Http::response('down', 503)]);
        $r = $this->provider()->send($this->input());
        $this->assertTrue($r->retryable);
        $this->assertSame('HTTP_503', $r->errorCode);

        Http::swap(new Factory);
        Http::fake([self::URL => fn () => throw new ConnectionException('cURL error 7: Failed to connect to api.automas.com.bd port 443')]);
        $this->assertSame('NETWORK_ERROR', $this->provider()->send($this->input())->errorCode);

        Http::swap(new Factory);
        Http::fake([self::URL => fn () => throw new ConnectionException('cURL error 28: Operation timed out after 15000 milliseconds with 0 bytes received')]);
        $this->assertTrue($this->provider()->send($this->input())->unconfirmed);
    }

    public function test_keeps_bulk_results_in_input_order(): void
    {
        Http::fake(fn (Request $q) => Http::response(['response' => [['status' => 0, 'id' => $q['msisdn']]]]));
        $numbers = array_map(fn ($i) => '+88017123456'.str_pad((string) $i, 2, '0', STR_PAD_LEFT), range(0, 11));
        $results = $this->provider()->sendBulk(array_map(fn ($n) => $this->input($n), $numbers));
        $this->assertSame(array_map(fn ($n) => ltrim($n, '+'), $numbers), array_map(fn ($r) => $r->providerMessageId, $results));
    }

    public function test_reports_missing_configuration_without_calling_the_network(): void
    {
        Http::fake();
        $r = $this->provider('')->send($this->input());
        $this->assertTrue(! $r->ok && $r->retryable);
        $this->assertSame('PROVIDER_NOT_CONFIGURED', $r->errorCode);
        Http::assertNothingSent();
    }

    public function test_declares_no_delivery_reports_and_refuses_all_webhooks(): void
    {
        $this->assertFalse($this->provider()->hasDeliveryReports());
        $this->assertFalse($this->provider()->verifyWebhook(new WebhookRequest([], '{}', [])));
    }

    public function test_is_registered_and_resolved_from_settings_with_the_stored_key(): void
    {
        config(['smsflow.sms.provider' => 'automas', 'smsflow.sms.provider_api_key' => 'env-key']);
        app(SettingsService::class)->clearCache();
        $manager = app(SmsProviderManager::class);
        $this->assertTrue($manager->has('automas'));
        $this->assertSame('automas', $manager->sendingProvider()->key());
    }

    public function test_sent_messages_stay_submitted_instead_of_expiring_after_72_hours(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
        config(['smsflow.sms.provider' => 'automas', 'smsflow.sms.provider_api_key' => 'k']);
        app(SettingsService::class)->clearCache();
        $this->reply(['status' => 0, 'id' => 42]);

        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $id = $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $k['headers'])->assertStatus(202)->json('data.message_id');
        $dispatcher = app(DispatcherService::class);
        $dispatcher->processQueue();
        $this->assertSame('SUBMITTED', Message::query()->find($id)->status->value);

        $this->travel(73)->hours();
        $this->assertSame(['checked' => 0, 'updated' => 0], $dispatcher->pollDeliveryStatuses());
        $this->assertSame('SUBMITTED', Message::query()->find($id)->status->value);
    }
}
