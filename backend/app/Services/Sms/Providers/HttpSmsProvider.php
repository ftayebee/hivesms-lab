<?php

namespace App\Services\Sms\Providers;

use App\Services\Sms\DeliveryStatus;
use App\Services\Sms\InboundSms;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SendSmsResult;
use App\Services\Sms\WebhookRequest;
use App\Support\Crypto;
use App\Support\Phone;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Generic HTTP gateway adapter (port of http-provider.ts).
 *
 * ⚠ UNVERIFIED SCAFFOLDING, exactly like the Node version. Many Bangladeshi gateways accept
 * "POST api_key, to, msg, sender_id → JSON", but parameter names, success flags, number formats
 * and delivery-report formats differ. Before production use: read the provider's docs, set the
 * parameter mapping (Admin → Settings → SMS provider), adjust interpretSendResponse() and
 * parseDeliveryWebhook(), and verify end to end with your own numbers.
 */
class HttpSmsProvider extends BaseSmsProvider
{
    /** @param array<string, string> $mapping */
    public function __construct(
        private readonly string $url,
        private readonly string $apiKey,
        private readonly string $apiSecret,
        private readonly string $webhookSecret,
        private readonly array $mapping = [],
        private readonly int $timeoutSeconds = 15,
    ) {}

    public function key(): string
    {
        return 'http';
    }

    public function displayName(): string
    {
        return 'Generic HTTP gateway (unverified)';
    }

    public function verified(): bool
    {
        return false;
    }

    private function param(string $name, string $fallback): string
    {
        return ($this->mapping[$name] ?? '') !== '' ? $this->mapping[$name] : $fallback;
    }

    /** @return array<string, string> */
    private function form(SendSmsInput $input): array
    {
        $form = [$this->param('apiKey', 'api_key') => $this->apiKey];
        if ($this->apiSecret !== '') {
            $form[$this->param('apiSecret', 'api_secret')] = $this->apiSecret;
        }
        $form[$this->param('to', 'to')] = ltrim($input->to, '+'); // most BD gateways expect 8801XXXXXXXXX
        $form[$this->param('message', 'msg')] = $input->message;
        $form[$this->param('senderId', 'sender_id')] = $input->senderId;
        $form[$this->param('type', 'type')] = $input->encoding === 'UCS2' ? 'unicode' : 'text';

        return $form;
    }

    public function send(SendSmsInput $input): SendSmsResult
    {
        return $this->sendBulk([$input])[0];
    }

    /** Small concurrency (5) to respect provider throughput limits. */
    public function sendBulk(array $inputs): array
    {
        if ($this->url === '' || $this->apiKey === '') {
            return array_map(fn () => SendSmsResult::failed(false, 'PROVIDER_NOT_CONFIGURED', 'SMS provider URL or API key is not configured.'), $inputs);
        }
        $results = [];
        foreach (array_chunk($inputs, 5) as $chunk) {
            $responses = Http::pool(fn (Pool $pool) => array_map(
                fn (SendSmsInput $i) => $pool->asForm()->acceptJson()->connectTimeout(min(5, $this->timeoutSeconds))->timeout($this->timeoutSeconds)->post($this->url, $this->form($i)),
                $chunk,
            ));
            foreach ($chunk as $idx => $input) {
                $results[] = $this->toResult($responses[$idx] ?? null, $input);
            }
        }

        return $results;
    }

    /**
     * Network errors: only failures that happen BEFORE the request reaches the provider (DNS,
     * refused or timed-out connect) are safe to retry. A read timeout or a connection dropped after
     * the request was sent is "unconfirmed": the provider may have accepted (and will deliver) the
     * SMS, so resending could deliver it twice.
     */
    public static function classifyConnectionError(string $message): SendSmsResult
    {
        $m = strtolower($message);
        $notSent = str_contains($m, 'could not resolve') || str_contains($m, 'failed to connect') || str_contains($m, 'connection refused')
            || str_contains($m, 'connection timed out after') || str_contains($m, 'resolving timed out');

        return $notSent
            ? SendSmsResult::failed(true, 'NETWORK_ERROR', 'Could not reach the SMS provider.')
            : SendSmsResult::unconfirmed('PROVIDER_TIMEOUT', 'The SMS provider did not confirm the message in time.');
    }

    private function toResult(mixed $res, SendSmsInput $input): SendSmsResult
    {
        if (! $res instanceof Response) {
            return self::classifyConnectionError($res instanceof \Throwable ? $res->getMessage() : '');
        }
        $status = $res->status();
        $text = $res->body();
        $json = json_decode($text, true);
        Log::info('provider send response', ['provider' => $this->key(), 'status' => $status, 'to' => Phone::mask($input->to)]);
        // 429 / 503: the provider refused to take the request → safe to retry later.
        if ($status === 429 || $status === 503) {
            return SendSmsResult::failed(true, "HTTP_{$status}", 'Provider temporarily unavailable.', $json ?? mb_substr($text, 0, 500));
        }
        // Other 5xx: the provider may have processed the request before failing → never resend.
        if ($status >= 500) {
            return SendSmsResult::unconfirmed("HTTP_{$status}", 'The SMS provider returned an error after receiving the message.', $json ?? mb_substr($text, 0, 500));
        }

        return $this->interpretSendResponse($status, is_array($json) ? $json : null, $text);
    }

    /** Adjust for your provider. Accepts common success shapes: {error:0}, {success:true}, {status:"success"}. */
    protected function interpretSendResponse(int $status, ?array $json, string $text): SendSmsResult
    {
        $body = $json ?? [];
        $data = is_array($body['data'] ?? null) ? $body['data'] : [];
        $success = $status >= 200 && $status < 300 && (
            ($body['error'] ?? null) === 0 || ($body['success'] ?? null) === true
            || in_array(strtolower((string) ($body['status'] ?? '')), ['success', 'ok', 'sent', 'queued'], true)
        );
        $id = $data['request_id'] ?? $data['message_id'] ?? $body['message_id'] ?? $body['id'] ?? $body['request_id'] ?? null;
        if ($success && $id !== null && $id !== '') {
            return SendSmsResult::accepted((string) $id, $body);
        }

        return SendSmsResult::failed(
            false,
            (string) ($body['error'] ?? $body['code'] ?? "HTTP_{$status}"),
            (string) ($body['msg'] ?? $body['message'] ?? (mb_substr($text, 0, 200) ?: 'Provider rejected the message.')),
            $json ?? mb_substr($text, 0, 500),
        );
    }

    /** Most gateways expose a report endpoint; implement per provider. Until then webhooks deliver status. */
    public function deliveryStatus(string $providerMessageId): DeliveryStatus
    {
        return new DeliveryStatus('UNKNOWN');
    }

    public function balance(): ?array
    {
        return null;
    }

    /** X-Signature = hex HMAC-SHA256(webhookSecret, rawBody), or ?token=<webhookSecret>. Never unsigned. */
    public function verifyWebhook(WebhookRequest $request): bool
    {
        if ($this->webhookSecret === '') {
            return false;
        }
        $sig = $request->header('x-signature');
        if ($sig !== null && $sig !== '') {
            return Crypto::safeEqual(Crypto::hmacSha256($this->webhookSecret, $request->rawBody), $sig);
        }
        $token = $request->query['token'] ?? null;

        return is_string($token) && $token !== '' && Crypto::safeEqual($this->webhookSecret, $token);
    }

    public function parseDeliveryWebhook(WebhookRequest $request): array
    {
        $body = $request->body();
        $items = $request->isJson()
            ? (array_is_list($body) ? $body : (is_array($body['events'] ?? null) ? $body['events'] : [$body]))
            : [$body];
        $out = [];
        foreach ($items as $e) {
            if (! is_array($e)) {
                continue;
            }
            $id = $e['message_id'] ?? $e['request_id'] ?? $e['id'] ?? null;
            if ($id === null || ! is_scalar($id) || $id === '') {
                continue;
            }
            $status = (string) ($e['status'] ?? $e['dlr_status'] ?? '');
            $ts = isset($e['timestamp']) ? (string) $e['timestamp'] : '';
            $out[] = new DeliveryStatus(
                status: DeliveryStatus::map($status),
                providerStatus: $status,
                errorCode: isset($e['error_code']) ? (string) $e['error_code'] : null,
                description: isset($e['description']) ? mb_substr((string) $e['description'], 0, 500) : null,
                occurredAt: MockSmsProvider::parseTime($ts),
                providerMessageId: (string) $id,
                eventKey: "http:{$id}:{$status}:{$ts}",
                raw: $e,
            );
        }

        return $out;
    }

    public function parseInboundWebhook(WebhookRequest $request): ?array
    {
        $b = $request->body();
        if (empty($b['from']) || empty($b['text'])) {
            return [];
        }

        return [new InboundSms(
            (string) $b['from'],
            (string) ($b['to'] ?? ''),
            (string) $b['text'],
            MockSmsProvider::parseTime(null),
            'http-inbound:'.($b['id'] ?? ($b['from'].':'.($b['timestamp'] ?? (string) now()->getTimestampMs()))),
        )];
    }
}
