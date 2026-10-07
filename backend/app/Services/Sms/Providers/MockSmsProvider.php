<?php

namespace App\Services\Sms\Providers;

use App\Services\Sms\DeliveryStatus;
use App\Services\Sms\InboundSms;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SendSmsResult;
use App\Services\Sms\WebhookRequest;
use App\Support\Crypto;
use Carbon\CarbonImmutable;

/**
 * Local simulator — NO MESSAGE LEAVES THE MACHINE (port of mock-provider.ts). Outcomes are
 * deterministic by the recipient's last digits so tests and demos are repeatable:
 *   …0000 rejected at submission · …8888 temporary error on every attempt (retries, then fails)
 *   …9999 accepted, then FAILED · anything else accepted, then DELIVERED ~3 s later.
 * Message ids encode result + submission time: mock_<d|f>_<ms base36>_<rand>.
 */
class MockSmsProvider extends BaseSmsProvider
{
    private const DELIVERY_DELAY_MS = 3000;

    public function __construct(private readonly string $webhookSecret = '') {}

    public function key(): string
    {
        return 'mock';
    }

    public function displayName(): string
    {
        return 'Mock provider (local simulation)';
    }

    public function verified(): bool
    {
        return true;
    }

    public function send(SendSmsInput $input): SendSmsResult
    {
        if (str_ends_with($input->to, '0000')) {
            return SendSmsResult::failed(false, 'MOCK_REJECTED', 'Recipient rejected by operator (simulated).');
        }
        if (str_ends_with($input->to, '8888')) {
            return SendSmsResult::failed(true, 'MOCK_TEMPORARY', 'Provider temporarily unavailable (simulated).');
        }
        $flag = str_ends_with($input->to, '9999') ? 'f' : 'd';
        $ms = CarbonImmutable::now()->getTimestampMs();

        return SendSmsResult::accepted("mock_{$flag}_".base_convert((string) $ms, 10, 36).'_'.Crypto::randomAlphanumeric(10));
    }

    public function deliveryStatus(string $providerMessageId): DeliveryStatus
    {
        if (! preg_match('/^mock_([df])_([0-9a-z]+)_/', $providerMessageId, $m)) {
            return new DeliveryStatus('UNKNOWN');
        }
        $submittedMs = (int) base_convert($m[2], 36, 10);
        $nowMs = CarbonImmutable::now()->getTimestampMs();
        if ($nowMs - $submittedMs < self::DELIVERY_DELAY_MS) {
            return new DeliveryStatus('SUBMITTED', 'ENROUTE');
        }
        $at = CarbonImmutable::createFromTimestampMs($submittedMs + self::DELIVERY_DELAY_MS, 'UTC');

        return $m[1] === 'd'
            ? new DeliveryStatus('DELIVERED', 'DELIVRD', null, 'Delivered (simulated)', $at)
            : new DeliveryStatus('FAILED', 'UNDELIV', 'MOCK_UNREACHABLE', 'Handset unreachable (simulated)', $at);
    }

    public function balance(): ?array
    {
        return ['amount' => 1000000, 'currency' => 'SMS', 'unit' => 'sms'];
    }

    /** X-Signature: hex HMAC-SHA256(webhookSecret, rawBody). Unsigned only outside production. */
    public function verifyWebhook(WebhookRequest $request): bool
    {
        if ($this->webhookSecret === '') {
            return ! app()->isProduction();
        }

        return Crypto::safeEqual(Crypto::hmacSha256($this->webhookSecret, $request->rawBody), (string) ($request->header('x-signature') ?? ''));
    }

    /** Payload: { "events": [{ "message_id", "status", "timestamp"?, "error_code"?, "description"? }] } */
    public function parseDeliveryWebhook(WebhookRequest $request): array
    {
        $body = json_decode($request->rawBody, true);
        $out = [];
        foreach ((is_array($body['events'] ?? null) ? $body['events'] : []) as $e) {
            if (! is_array($e) || ! isset($e['message_id']) || ! is_scalar($e['message_id'])) {
                continue;
            }
            $status = (string) ($e['status'] ?? '');
            $at = self::parseTime($e['timestamp'] ?? null);
            $out[] = new DeliveryStatus(
                status: DeliveryStatus::map($status),
                providerStatus: $status,
                errorCode: isset($e['error_code']) ? (string) $e['error_code'] : null,
                description: isset($e['description']) ? mb_substr((string) $e['description'], 0, 500) : null,
                occurredAt: $at,
                providerMessageId: (string) $e['message_id'],
                eventKey: 'mock:'.$e['message_id'].':'.$status.':'.$at->format('Y-m-d\TH:i:s.v\Z'),
                raw: $e,
            );
        }

        return $out;
    }

    /** Payload: { "messages": [{ "id", "from", "to", "text", "timestamp"? }] } */
    public function parseInboundWebhook(WebhookRequest $request): ?array
    {
        $body = json_decode($request->rawBody, true);
        $out = [];
        foreach ((is_array($body['messages'] ?? null) ? $body['messages'] : []) as $m) {
            if (! is_array($m) || ! isset($m['id'], $m['from'], $m['text'])) {
                continue;
            }
            $out[] = new InboundSms((string) $m['from'], (string) ($m['to'] ?? ''), (string) $m['text'], self::parseTime($m['timestamp'] ?? null), 'mock-inbound:'.$m['id']);
        }

        return $out;
    }

    public static function parseTime(mixed $value): CarbonImmutable
    {
        if (is_string($value) && $value !== '') {
            try {
                return CarbonImmutable::parse($value)->utc();
            } catch (\Throwable) {
            }
        }

        return CarbonImmutable::now('UTC');
    }
}
