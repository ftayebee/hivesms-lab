<?php

namespace App\Services\Messaging;

use App\Models\Message;
use App\Models\MessageEvent;
use App\Services\Platform\SettingsService;
use App\Services\Wallet\WalletService;
use App\Support\Dhaka;
use App\Support\Money;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Message status transitions (port of services/messaging/delivery.ts). Status only moves forward:
 *
 *   QUEUED ─► SUBMITTED ─► DELIVERED
 *     │          └──────► FAILED | REJECTED | EXPIRED
 *     ├─► FAILED | REJECTED | CANCELLED | DELIVERED
 *     └─► UNKNOWN ─► SUBMITTED | DELIVERED | FAILED | REJECTED   (staff resolution / late report)
 *
 * UNKNOWN = the provider may have taken the message (timeout, dropped connection, worker died
 * mid-request). It stays charged, is never resent and is only refunded when a staff member
 * resolves it as failed with an explicit refund (refund => true).
 *
 * Terminal statuses never change, so late or replayed provider events cannot overwrite a final
 * result. Every received event is stored in message_events under a unique dedupeKey — that is
 * what makes webhook and poll processing idempotent: a duplicate event changes nothing, never
 * double-counts a delivery and never refunds twice.
 */
class DeliveryService
{
    private const ALLOWED_FROM = [
        'QUEUED' => [],
        'SUBMITTED' => ['QUEUED', 'UNKNOWN'],
        'DELIVERED' => ['QUEUED', 'SUBMITTED', 'UNKNOWN'],
        'FAILED' => ['QUEUED', 'SUBMITTED', 'UNKNOWN'],
        'REJECTED' => ['QUEUED', 'SUBMITTED', 'UNKNOWN'],
        'EXPIRED' => ['QUEUED', 'SUBMITTED'],
        'CANCELLED' => ['QUEUED'],
        'UNKNOWN' => ['QUEUED'],
    ];

    /** Message columns a status update may also write (provider response capture). */
    private const EXTRA_FIELDS = ['providerStatusCode', 'providerResponse', 'providerRequestedAt', 'providerRespondedAt'];

    public const TERMINAL_FAILURES = ['FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED'];

    public function __construct(
        private readonly SettingsService $settings,
        private readonly WalletService $wallet,
        private readonly OutboundWebhookService $webhooks,
    ) {}

    /**
     * @param  array{messageId: string, status: string, source: string, dedupeKey: string, occurredAt?: ?CarbonImmutable, providerStatus?: ?string, errorCode?: ?string, description?: ?string, provider?: ?string, providerMessageId?: ?string, payload?: mixed, refund?: ?bool, fields?: array<string, mixed>}  $u
     * @return 'applied'|'duplicate'|'stale'|'not_found'
     */
    public function apply(array $u): string
    {
        $policy = $this->settings->smsPolicy();
        $occurredAt = $u['occurredAt'] ?? CarbonImmutable::now('UTC');
        $ts = $occurredAt->format('Y-m-d H:i:s.v');

        // Retried as a whole if InnoDB picks it as a deadlock victim (it was rolled back: safe).
        $outcome = DB::transaction(function () use ($u, $policy, $occurredAt, $ts) {
            $locked = DB::selectOne('SELECT id, status, provider FROM messages WHERE id = ? FOR UPDATE', [$u['messageId']]);
            if (! $locked) {
                return 'not_found';
            }
            // A worker marked it in flight between our read and this lock: leave it to its outcome.
            if (($u['notInFlight'] ?? false) && $locked->status === 'QUEUED' && $locked->provider !== null) {
                return 'stale';
            }
            $inserted = MessageEvent::query()->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'messageId' => $u['messageId'],
                'status' => $u['status'],
                'providerStatus' => isset($u['providerStatus']) ? mb_substr($u['providerStatus'], 0, 255) : null,
                'description' => $u['description'] ?? null,
                'source' => $u['source'],
                'dedupeKey' => mb_substr($u['dedupeKey'], 0, 512),
                'payload' => array_key_exists('payload', $u) && $u['payload'] !== null ? json_encode($u['payload'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
                'occurredAt' => $ts,
                'receivedAt' => now()->format('Y-m-d H:i:s.v'),
            ]);
            if (! $inserted) {
                return 'duplicate';
            }
            $previous = $locked->status;
            if (! in_array($previous, self::ALLOWED_FROM[$u['status']] ?? [], true)) {
                return 'stale';
            }

            $isFailure = in_array($u['status'], self::TERMINAL_FAILURES, true);
            $data = ['status' => $u['status'], 'lockedUntil' => null, 'nextAttemptAt' => null];
            if (! empty($u['provider'])) {
                $data['provider'] = $u['provider'];
            }
            if (! empty($u['providerMessageId'])) {
                $data['providerMessageId'] = $u['providerMessageId'];
            }
            if (array_key_exists('errorCode', $u)) {
                $data['errorCode'] = $u['errorCode'] !== null ? mb_substr($u['errorCode'], 0, 255) : null;
            }
            if (! empty($u['description']) && ! in_array($u['status'], ['DELIVERED', 'SUBMITTED'], true)) {
                $data['errorMessage'] = $u['description'];
            }
            foreach (self::EXTRA_FIELDS as $f) {
                if (array_key_exists($f, $u['fields'] ?? [])) {
                    $v = $u['fields'][$f];
                    $data[$f] = $f === 'providerResponse' && $v !== null ? json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : $v;
                }
            }
            if ($u['status'] === 'SUBMITTED' || ($u['status'] === 'DELIVERED' && $previous === 'UNKNOWN')) {
                $data['submittedAt'] = $ts;
            }
            if ($u['status'] === 'DELIVERED') {
                $data['deliveredAt'] = $ts;
                if ($previous === 'QUEUED') {
                    $data['submittedAt'] = $ts;
                }
            }
            if ($isFailure) {
                $data['failedAt'] = $ts;
            }
            Message::query()->whereKey($u['messageId'])->update($data);
            $msg = Message::query()->findOrFail($u['messageId'], ['id', 'organizationId', 'campaignId', 'to', 'segments', 'cost', 'refundedAt', 'errorCode', 'errorMessage', 'clientReference']);

            // Refunds: always when the message never left the platform; otherwise per policy.
            // An UNKNOWN message may have been delivered: refunded only on an explicit staff decision.
            $refundAllowed = $previous === 'UNKNOWN' ? ($u['refund'] ?? false) === true : ($u['refund'] ?? true) !== false && ($previous === 'QUEUED' || $policy['refundFailedMessages']);
            $shouldRefund = $isFailure && $refundAllowed && Money::isPositive((string) $msg->cost) && ! $msg->refundedAt;
            if ($shouldRefund) {
                $this->wallet->credit([
                    'organizationId' => $msg->organizationId,
                    'amount' => (string) $msg->cost,
                    'reason' => 'REFUND',
                    'description' => 'Refund: '.strtolower($u['status'])." message to {$msg->to}",
                    'referenceType' => 'message',
                    'referenceId' => $msg->id,
                ]);
                Message::query()->whereKey($msg->id)->update(['refundedAt' => now()->format('Y-m-d H:i:s.v')]);
            }

            if ($msg->campaignId) {
                $inc = [];
                if ($previous === 'QUEUED') {
                    $inc[] = 'queuedCount = GREATEST(queuedCount - 1, 0)';
                }
                if ($previous === 'UNKNOWN') {
                    $inc[] = 'unknownCount = GREATEST(unknownCount - 1, 0)';
                }
                if ($u['status'] === 'UNKNOWN') {
                    $inc[] = 'unknownCount = unknownCount + 1';
                }
                if ($u['status'] === 'SUBMITTED' || ($u['status'] === 'DELIVERED' && in_array($previous, ['QUEUED', 'UNKNOWN'], true))) {
                    $inc[] = 'submittedCount = submittedCount + 1';
                }
                if ($u['status'] === 'DELIVERED') {
                    $inc[] = 'deliveredCount = deliveredCount + 1';
                }
                if ($isFailure) {
                    $inc[] = 'failedCount = failedCount + 1';
                }
                $bindings = [];
                if ($shouldRefund) {
                    $inc[] = 'refundedAmount = refundedAmount + CAST(? AS DECIMAL(14,4))';
                    $inc[] = 'actualCost = actualCost - CAST(? AS DECIMAL(14,4))';
                    $bindings = [(string) $msg->cost, (string) $msg->cost];
                }
                if ($inc) {
                    $inc[] = 'updatedAt = ?';
                    $bindings[] = now()->format('Y-m-d H:i:s.v');
                    $bindings[] = $msg->campaignId;
                    DB::update('UPDATE campaigns SET '.implode(', ', $inc).' WHERE id = ?', $bindings);
                }
            }

            if ($u['status'] === 'DELIVERED' || $isFailure) {
                $this->webhooks->enqueue($msg->organizationId, $u['status'] === 'DELIVERED' ? 'message.delivered' : 'message.failed', [
                    'message_id' => $msg->id,
                    'to' => $msg->to,
                    'status' => strtolower($u['status']),
                    'error_code' => $msg->errorCode,
                    'error_message' => $msg->errorMessage,
                    'segments' => $msg->segments,
                    'cost' => Money::plain((string) $msg->cost),
                    'refunded' => $shouldRefund,
                    'client_reference' => $msg->clientReference,
                    'campaign_id' => $msg->campaignId,
                    'occurred_at' => Dhaka::iso($occurredAt),
                ]);
            }

            return 'applied';
        }, 3);

        if ($outcome === 'stale') {
            Log::debug('ignored out-of-order status update', ['messageId' => $u['messageId'], 'status' => $u['status']]);
        }

        return $outcome;
    }

    /** @return array{id: string, organizationId: string}|null */
    public function findByProviderId(string $provider, string $providerMessageId): ?array
    {
        $m = Message::query()->where('provider', $provider)->where('providerMessageId', $providerMessageId)->first(['id', 'organizationId']);

        return $m ? ['id' => $m->id, 'organizationId' => $m->organizationId] : null;
    }

    /** Cancels (and refunds) still-queued messages of a cancelled campaign; returns how many remain. */
    public function cancelQueuedOfCampaign(string $campaignId, int $limit): int
    {
        // In-flight messages (provider already set) are left alone: they reach their real outcome
        // (accepted/failed), or UNKNOWN if the worker dies — never cancelled-and-refunded mid-request.
        $ids = Message::query()->where('campaignId', $campaignId)->where('status', 'QUEUED')->whereNull('provider')->limit($limit)->pluck('id');
        foreach ($ids as $id) {
            $this->apply(['messageId' => $id, 'status' => 'CANCELLED', 'source' => 'SYSTEM', 'dedupeKey' => "cancel:{$id}", 'description' => 'Campaign cancelled', 'notInFlight' => true]);
        }

        return Message::query()->where('campaignId', $campaignId)->where('status', 'QUEUED')->whereNull('provider')->count();
    }
}
