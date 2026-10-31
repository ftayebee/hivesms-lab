<?php

namespace App\Services\Messaging;

use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Support\Crypto;
use App\Support\Dhaka;
use App\Support\SafeUrl;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Customer-facing webhooks (port of services/messaging/outbound-webhooks.ts). Each request carries
 *   X-SMSFlow-Event, X-SMSFlow-Delivery (unique id, for de-duplication) and
 *   X-SMSFlow-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>.
 * Failed deliveries retry with exponential backoff, up to 8 attempts (about a day).
 */
class OutboundWebhookService
{
    public const EVENTS = [
        'message.delivered' => 'A message was delivered to the handset',
        'message.failed' => 'A message failed permanently (failed, rejected, expired or cancelled)',
        'campaign.completed' => 'A campaign finished sending',
    ];

    private const MAX_ATTEMPTS = 8;

    /** Queues one delivery per active endpoint subscribed to $event (works inside a transaction). */
    public function enqueue(string $organizationId, string $event, array $data): void
    {
        $endpoints = WebhookEndpoint::query()
            ->where('organizationId', $organizationId)
            ->where('active', true)
            ->whereJsonContains('events', $event)
            ->pluck('id');
        if ($endpoints->isEmpty()) {
            return;
        }
        $payload = json_encode(['event' => $event, 'created_at' => Dhaka::iso(now()), 'data' => $data], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $now = now()->format('Y-m-d H:i:s.v');
        WebhookDelivery::query()->insert($endpoints->map(fn ($id) => [
            'id' => (string) Str::uuid(),
            'endpointId' => $id,
            'event' => $event,
            'payload' => $payload,
            'status' => 'PENDING',
            'attempts' => 0,
            'nextAttemptAt' => $now,
            'createdAt' => $now,
            'updatedAt' => $now,
        ])->all());
    }

    public static function sign(string $secret, string $body, ?int $timestamp = null): string
    {
        $t = $timestamp ?? time();

        return "t={$t},v1=".Crypto::hmacSha256($secret, "{$t}.{$body}");
    }

    /** @return array{processed: int, delivered: int} */
    public function deliverPending(int $limit = 50): array
    {
        $due = WebhookDelivery::query()
            ->with('endpoint')
            ->where('status', 'PENDING')
            ->where('nextAttemptAt', '<=', now()->format('Y-m-d H:i:s.v'))
            ->orderBy('nextAttemptAt')
            ->limit($limit)
            ->get();
        $delivered = 0;
        foreach ($due as $d) {
            // Claim (optimistic, by attempt count) so parallel workers never double-deliver.
            $claimed = WebhookDelivery::query()->whereKey($d->id)->where('status', 'PENDING')->where('attempts', $d->attempts)
                ->update(['attempts' => DB::raw('attempts + 1'), 'nextAttemptAt' => now()->addMinutes(5)->format('Y-m-d H:i:s.v'), 'updatedAt' => now()->format('Y-m-d H:i:s.v')]);
            if (! $claimed) {
                continue;
            }
            $endpoint = $d->endpoint;
            if (! $endpoint || ! $endpoint->active) {
                $d->forceFill(['status' => 'FAILED', 'responseBody' => 'Endpoint disabled'])->save();

                continue;
            }
            $body = json_encode(['id' => $d->id] + (array) $d->payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $status = 0;
            $responseBody = '';
            try {
                SafeUrl::assertPublicDestination($endpoint->url); // DNS can change after creation
                $secret = Crypto::decryptSecret($endpoint->secretEncrypted);
                $res = Http::withHeaders([
                    'Content-Type' => 'application/json',
                    'User-Agent' => 'SMSFlow-Webhooks/1.0',
                    'X-SMSFlow-Event' => $d->event,
                    'X-SMSFlow-Delivery' => $d->id,
                    'X-SMSFlow-Signature' => self::sign($secret, $body),
                ])->withOptions(['allow_redirects' => false])->timeout(10)->withBody($body, 'application/json')->post($endpoint->url);
                $status = $res->status();
                $responseBody = mb_substr($res->body(), 0, 1000);
            } catch (Throwable $e) {
                $responseBody = mb_substr($e->getMessage(), 0, 500);
            }
            $ok = $status >= 200 && $status < 300;
            $attempts = $d->attempts + 1;
            $d->forceFill([
                'status' => $ok ? 'SUCCEEDED' : ($attempts >= self::MAX_ATTEMPTS ? 'FAILED' : 'PENDING'),
                'responseStatus' => $status ?: null,
                'responseBody' => $responseBody,
                'nextAttemptAt' => $ok || $attempts >= self::MAX_ATTEMPTS ? null : now()->addSeconds(min((2 ** $attempts) * 30, 6 * 3600)),
            ])->save();
            WebhookEndpoint::query()->whereKey($endpoint->id)->update([
                'lastDeliveryAt' => now()->format('Y-m-d H:i:s.v'),
                'lastStatusCode' => $status ?: null,
                'failureCount' => $ok ? 0 : DB::raw('failureCount + 1'),
                'updatedAt' => now()->format('Y-m-d H:i:s.v'),
            ]);
            if ($ok) {
                $delivered++;
            } else {
                Log::warning('webhook delivery failed', ['endpoint' => $endpoint->id, 'status' => $status, 'attempts' => $attempts]);
            }
        }

        return ['processed' => $due->count(), 'delivered' => $delivered];
    }
}
