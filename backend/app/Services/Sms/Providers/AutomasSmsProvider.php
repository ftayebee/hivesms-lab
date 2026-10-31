<?php

namespace App\Services\Sms\Providers;

use App\Services\Sms\DeliveryStatus;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SendSmsResult;
use App\Services\Sms\WebhookRequest;
use App\Support\Phone;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Automas Technologies (https://sms.automas.com.bd/api, read 2026-10-31; port of automas-provider.ts).
 *
 * Uses the plain HTTP endpoint with a form POST, so the API key stays out of URLs and access logs.
 * It is the only endpoint documenting the Unicode flags, and it needs one request per message so
 * each message gets its own id. Response shapes were recorded from the live API using a
 * deliberately invalid key: {"response":[{"status":106,"id":165804,"msisdn":"8801700000000"}]}.
 * A failed send still carries an id, so only status 0 means accepted.
 *
 * Not offered by the documented API, so not implemented: delivery reports, inbound SMS and balance.
 *
 * verified() stays false until the checklist in docs/05-integrations.md passes with a real key.
 */
class AutomasSmsProvider extends BaseSmsProvider
{
    private const SEND_URL = 'https://api.automas.com.bd/smsapiv3';

    private const UNICODE = '8';

    private const CONCURRENCY = 5;

    private const STATUS_MESSAGES = [
        101 => 'Invalid message length.',
        102 => 'Sender ID is not approved by the SMS provider.',
        103 => 'SMS provider authentication failed.',
        104 => 'SMS provider rejected the account as invalid.',
        105 => 'Invalid recipient number.',
        106 => 'Incorrect SMS provider API key.',
        107 => 'SMS provider account is suspended.',
        108 => "This server's IP address is not allowed by the SMS provider.",
        109 => 'API access is not enabled on the SMS provider account.',
        110 => 'Recipient is on the Do Not Disturb list.',
        111 => 'Message contains a word blocked by the SMS provider.',
        1000 => 'SMS provider balance is insufficient.',
        2000 => 'Destination provider is unavailable.',
        2300 => 'Destination route issue.',
        2400 => 'API access is not enabled on the SMS provider account.',
        3000 => 'Destination provider is unavailable.',
        3300 => 'SMS provider system error.',
        4000 => 'Destination provider is unavailable.',
    ];

    /**
     * Only faults of the message itself are final. Account problems (key, suspension, IP allowlist,
     * empty balance) are retried with backoff so that customers' messages survive until an operator
     * fixes the account; they are refunded if the retries run out.
     */
    private const PERMANENT_STATUSES = [101, 102, 105, 110, 111];

    public function __construct(
        private readonly string $apiKey,
        private readonly int $timeoutSeconds = 15,
    ) {}

    public function key(): string
    {
        return 'automas';
    }

    public function displayName(): string
    {
        return 'Automas Technologies';
    }

    public function verified(): bool
    {
        return false;
    }

    public function hasDeliveryReports(): bool
    {
        return false;
    }

    /** @return array<string, string> */
    private function form(SendSmsInput $input): array
    {
        $form = [
            'apikey' => $this->apiKey,
            'sender' => ltrim($input->senderId, '+'),
            'msisdn' => ltrim($input->to, '+'),
            'smstext' => $input->message,
        ];
        // Per the logged-in API page: type=long for multi-part, smsformat=8 for Unicode.
        if (MessageSegmentCalculator::calculate($input->message)['segments'] > 1) {
            $form['type'] = 'long';
        }
        if ($input->encoding === 'UCS2') {
            $form['smsformat'] = self::UNICODE;
        }

        return $form;
    }

    public function send(SendSmsInput $input): SendSmsResult
    {
        return $this->sendBulk([$input])[0];
    }

    public function sendBulk(array $inputs): array
    {
        if ($this->apiKey === '') {
            // An account problem like the ones above: customers' messages wait for an operator to fix it.
            return array_map(fn () => SendSmsResult::failed(true, 'PROVIDER_NOT_CONFIGURED', 'SMS provider API key is not configured.'), $inputs);
        }
        $results = [];
        foreach (array_chunk($inputs, self::CONCURRENCY) as $chunk) {
            $responses = Http::pool(fn (Pool $pool) => array_map(
                fn (SendSmsInput $i) => $pool->asForm()->acceptJson()->connectTimeout(min(5, $this->timeoutSeconds))->timeout($this->timeoutSeconds)->post(self::SEND_URL, $this->form($i)),
                $chunk,
            ));
            foreach ($chunk as $idx => $input) {
                $results[] = $this->toResult($responses[$idx] ?? null, $input);
            }
        }

        return $results;
    }

    private function toResult(mixed $res, SendSmsInput $input): SendSmsResult
    {
        if (! $res instanceof Response) {
            return HttpSmsProvider::classifyConnectionError($res instanceof \Throwable ? $res->getMessage() : '');
        }
        $status = $res->status();
        $text = $res->body();
        Log::info('provider send response', ['provider' => $this->key(), 'status' => $status, 'to' => Phone::mask($input->to)]);
        if ($status === 429 || $status === 503) {
            return SendSmsResult::failed(true, "HTTP_{$status}", 'Provider temporarily unavailable.', mb_substr($text, 0, 500));
        }
        if ($status >= 500) {
            return SendSmsResult::unconfirmed("HTTP_{$status}", 'The SMS provider returned an error after receiving the message.', mb_substr($text, 0, 500));
        }

        return $this->interpretSendResponse($status, $text, $input->reference);
    }

    private function interpretSendResponse(int $httpStatus, string $text, string $reference): SendSmsResult
    {
        $json = json_decode($text, true);
        $entry = is_array($json) && is_array($json['response'][0] ?? null) ? $json['response'][0] : null;
        $code = $entry['status'] ?? null;
        // The message may or may not have gone out, and without a client reference a resend could
        // deliver it twice. Undocumented statuses are the same: nothing says it was refused.
        if (! is_numeric($code)) {
            return SendSmsResult::unconfirmed("INVALID_RESPONSE_{$httpStatus}", 'Unexpected response from the SMS provider.', mb_substr($text, 0, 500));
        }
        $code = (int) $code;
        if ($code === 0) {
            return SendSmsResult::accepted((string) ($entry['id'] ?? $reference), $entry);
        }
        if (! isset(self::STATUS_MESSAGES[$code])) {
            return SendSmsResult::unconfirmed("AUTOMAS_{$code}", 'Unexpected status from the SMS provider.', $entry);
        }

        return SendSmsResult::failed(! in_array($code, self::PERMANENT_STATUSES, true), "AUTOMAS_{$code}", self::STATUS_MESSAGES[$code], $entry);
    }

    public function deliveryStatus(string $providerMessageId): DeliveryStatus
    {
        return new DeliveryStatus('UNKNOWN');
    }

    public function balance(): ?array
    {
        return null;
    }

    /** Automas documents no webhooks, so nothing can be authenticated: every request is refused. */
    public function verifyWebhook(WebhookRequest $request): bool
    {
        return false;
    }

    public function parseDeliveryWebhook(WebhookRequest $request): array
    {
        return [];
    }
}
