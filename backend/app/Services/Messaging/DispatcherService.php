<?php

namespace App\Services\Messaging;

use App\Models\Message;
use App\Services\Platform\SettingsService;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SmsProviderInterface;
use App\Services\Sms\SmsProviderManager;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Sends queued messages to the upstream provider (port of services/messaging/dispatcher.ts).
 *
 * Claiming: a non-locking read picks due candidates; a short transaction row-locks them by
 * primary key (FOR UPDATE, id order), re-checks they are still claimable and sets a lease
 * (lockedUntil) + attempts+1. A concurrent worker waits, re-reads, sees the lease and skips them,
 * so overlapping workers/cron ticks never claim the same message. Messages of paused/cancelled
 * campaigns and suspended organizations are never claimed.
 *
 * In-flight marker: right before calling the provider, `provider` is set on the claimed rows (it
 * is otherwise only set when the provider answered). If the worker dies after that point, the
 * outcome is unknown — the provider may have accepted the SMS — so such rows are never claimed
 * again; failInterruptedSends() closes them as FAILED (refunded) instead of risking a duplicate.
 * Messages whose lease expired BEFORE the marker was written were never sent and are retried.
 *
 * Portable to MySQL 8+ and MariaDB 10.4+ (no SKIP LOCKED, no UPDATE … RETURNING).
 */
class DispatcherService
{
    public function __construct(
        private readonly SmsProviderManager $providers,
        private readonly SettingsService $settings,
        private readonly DeliveryService $delivery,
    ) {}

    private const DUE = "m.status = 'QUEUED' AND m.provider IS NULL AND m.nextAttemptAt <= ? AND (m.lockedUntil IS NULL OR m.lockedUntil < ?)";

    /**
     * @param  list<string>|null  $ids  restrict to these messages (inline dispatch)
     * @return list<string> claimed message ids
     */
    public function claim(int $limit, ?array $ids = null): array
    {
        if ($ids !== null && ! $ids) {
            return [];
        }
        $claimed = [];
        // Candidates taken by a concurrent claimer are lost at the lock step: re-read a few times.
        for ($round = 0; $round < 4 && count($claimed) < $limit; $round++) {
            $now = now()->format('Y-m-d H:i:s.v');
            $bindings = [$now, $now];
            $idFilter = '';
            if ($ids) {
                $idFilter = ' AND m.id IN ('.implode(',', array_fill(0, count($ids), '?')).')';
                $bindings = array_merge($bindings, $ids);
            }
            $bindings[] = $limit - count($claimed);
            $candidates = array_column(DB::select(
                'SELECT m.id FROM messages m WHERE '.self::DUE.'
                   AND (m.campaignId IS NULL OR EXISTS (SELECT 1 FROM campaigns c WHERE c.id = m.campaignId AND c.status = \'PROCESSING\'))
                   AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = m.organizationId AND o.status = \'ACTIVE\')'.$idFilter.'
                 ORDER BY m.nextAttemptAt LIMIT ?',
                $bindings,
            ), 'id');
            if (! $candidates) {
                break;
            }
            $got = $this->lease($candidates);
            array_push($claimed, ...$got);
            if (count($got) === count($candidates)) {
                break;
            }
        }

        return $claimed;
    }

    /** @param list<string> $candidateIds */
    private function lease(array $candidateIds): array
    {
        sort($candidateIds);

        return DB::transaction(function () use ($candidateIds) {
            $now = now();
            $ts = $now->format('Y-m-d H:i:s.v');
            $in = implode(',', array_fill(0, count($candidateIds), '?'));
            // Locks only message rows, by primary key in id order (same order as status updates → no deadlocks).
            $leased = array_column(DB::select("SELECT m.id FROM messages m WHERE m.id IN ({$in}) AND ".self::DUE.' ORDER BY m.id FOR UPDATE', [...$candidateIds, $ts, $ts]), 'id');
            if ($leased) {
                $until = $now->addSeconds((int) config('smsflow.sms.lease_seconds'))->format('Y-m-d H:i:s.v');
                $in2 = implode(',', array_fill(0, count($leased), '?'));
                DB::update("UPDATE messages SET lockedUntil = ?, attempts = attempts + 1, updatedAt = ? WHERE id IN ({$in2})", [$until, $ts, ...$leased]);
            }

            return $leased;
        }, 3);
    }

    /** 30s, 1m, 2m, 4m … capped at 30 min, plus jitter. */
    private function backoffSeconds(int $attempt): int
    {
        return (int) min(30 * (2 ** max(0, $attempt - 1)), 1800) + random_int(0, 5);
    }

    /**
     * Sends claimed messages. Must only be called with ids returned by claim().
     *
     * @param  list<string>  $ids
     * @return array{submitted: int, failed: int, retried: int}
     */
    public function dispatch(array $ids, ?SmsProviderInterface $provider = null): array
    {
        if (! $ids) {
            return ['submitted' => 0, 'failed' => 0, 'retried' => 0];
        }
        $provider ??= $this->providers->sendingProvider();
        $policy = $this->settings->smsPolicy();
        // In-flight marker (see class doc). Only rows still QUEUED and leased by us are marked and sent.
        $in = implode(',', array_fill(0, count($ids), '?'));
        DB::update("UPDATE messages SET provider = ?, updatedAt = ? WHERE id IN ({$in}) AND status = 'QUEUED' AND provider IS NULL", [$provider->key(), now()->format('Y-m-d H:i:s.v'), ...$ids]);
        $messages = Message::query()->whereIn('id', $ids)->where('status', 'QUEUED')->where('provider', $provider->key())
            ->get(['id', 'to', 'body', 'senderValue', 'senderType', 'smsType', 'encoding', 'attempts'])->values();
        $results = $provider->sendBulk($messages->map(fn (Message $m) => new SendSmsInput(
            $m->id, $m->to, $m->body, $m->senderValue, $m->senderType->value, $m->smsType->value, $m->encoding->value,
        ))->all());

        $submitted = $failed = $retried = 0;
        foreach ($messages as $i => $m) {
            $r = $results[$i];
            try {
                if ($r->ok) {
                    $this->delivery->apply([
                        'messageId' => $m->id, 'status' => 'SUBMITTED', 'source' => 'PROVIDER_RESPONSE', 'dedupeKey' => "submit:{$m->id}",
                        'provider' => $provider->key(), 'providerMessageId' => $r->providerMessageId, 'description' => 'Accepted by provider',
                    ]);
                    $submitted++;
                } elseif ($r->unconfirmed) {
                    // Possibly accepted by the provider: never resend (duplicate risk); close and refund.
                    $this->delivery->apply([
                        'messageId' => $m->id, 'status' => 'FAILED', 'source' => 'PROVIDER_RESPONSE', 'dedupeKey' => "submit-unconfirmed:{$m->id}",
                        'provider' => $provider->key(), 'errorCode' => $r->errorCode,
                        'description' => "{$r->errorMessage} Not retried automatically to avoid sending a duplicate SMS.",
                    ]);
                    $failed++;
                    Log::warning('provider outcome unconfirmed, message not retried', ['messageId' => $m->id, 'to' => Phone::mask($m->to), 'code' => $r->errorCode]);
                } elseif ($r->retryable && $m->attempts < $policy['maxAttempts']) {
                    Message::query()->whereKey($m->id)->where('status', 'QUEUED')->update([
                        'provider' => null, // certainly not sent: claimable again
                        'lockedUntil' => null,
                        'nextAttemptAt' => now()->addSeconds($this->backoffSeconds($m->attempts))->format('Y-m-d H:i:s.v'),
                        'errorCode' => mb_substr((string) $r->errorCode, 0, 255),
                        'errorMessage' => $r->errorMessage,
                    ]);
                    $retried++;
                    Log::warning('provider send failed, will retry', ['messageId' => $m->id, 'to' => Phone::mask($m->to), 'attempt' => $m->attempts, 'code' => $r->errorCode]);
                } else {
                    // Permanent failure, or transient failures exhausted: no infinite retries.
                    $this->delivery->apply([
                        'messageId' => $m->id, 'status' => $r->retryable ? 'FAILED' : 'REJECTED', 'source' => 'PROVIDER_RESPONSE',
                        'dedupeKey' => "submit-fail:{$m->id}", 'provider' => $provider->key(), 'errorCode' => $r->errorCode,
                        'description' => $r->retryable ? "{$r->errorMessage} (gave up after {$m->attempts} attempts)" : $r->errorMessage,
                    ]);
                    $failed++;
                }
            } catch (Throwable $e) {
                Log::error('error recording dispatch result', ['messageId' => $m->id, 'error' => $e->getMessage()]);
            }
        }

        return ['submitted' => $submitted, 'failed' => $failed, 'retried' => $retried];
    }

    /**
     * Messages whose send started (in-flight marker set) but whose worker died before recording
     * the provider's answer. Their outcome is unknown, so they are closed as FAILED (refunded)
     * rather than resent. Only rows whose lease expired are touched.
     */
    public function failInterruptedSends(int $limit = 200): int
    {
        $ids = Message::query()->where('status', 'QUEUED')->whereNotNull('provider')
            ->where('lockedUntil', '<', now()->format('Y-m-d H:i:s.v'))->limit($limit)->pluck('id');
        foreach ($ids as $id) {
            $this->delivery->apply([
                'messageId' => $id, 'status' => 'FAILED', 'source' => 'SYSTEM', 'dedupeKey' => "send-interrupted:{$id}", 'errorCode' => 'SEND_INTERRUPTED',
                'description' => 'Sending was interrupted and the provider did not confirm the message. Not retried automatically to avoid sending a duplicate SMS.',
            ]);
            Log::warning('interrupted send closed without retry', ['messageId' => $id]);
        }

        return $ids->count();
    }

    /** One dispatch cycle: claim a batch and send it (nothing is claimed if sending is unavailable). */
    public function processQueue(int $batchSize = 100): array
    {
        if (! $this->providers->sendingAvailable()) {
            Log::error('SMS sending unavailable: the configured provider cannot be used in this environment; messages stay queued');

            return ['claimed' => 0, 'submitted' => 0, 'failed' => 0, 'retried' => 0];
        }
        $this->failInterruptedSends();
        $ids = $this->claim($batchSize);
        if (! $ids) {
            return ['claimed' => 0, 'submitted' => 0, 'failed' => 0, 'retried' => 0];
        }

        return ['claimed' => count($ids)] + $this->dispatch($ids);
    }

    /** Immediate dispatch of specific messages (after an API/dashboard send). Never throws. */
    public function dispatchNow(array $messageIds): void
    {
        try {
            if (! $this->providers->sendingAvailable()) {
                return;
            }
            $claimed = $this->claim(count($messageIds), $messageIds);
            if ($claimed) {
                $this->dispatch($claimed);
            }
        } catch (Throwable $e) {
            Log::error('inline dispatch failed; the worker will pick the messages up', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Polls the provider for messages without a delivery report (fallback for providers without
     * webhooks, and how the mock provider delivers). No report after 72 h → EXPIRED, no refund
     * (the provider accepted the message).
     */
    public function pollDeliveryStatuses(int $limit = 200): array
    {
        if (! $this->providers->sendingAvailable()) {
            return ['checked' => 0, 'updated' => 0]; // e.g. mock in production: never fake deliveries
        }
        $provider = $this->providers->sendingProvider();
        $pollAfterSeconds = $provider->key() === 'mock' ? 3 : 300;
        $candidates = Message::query()
            ->where('status', 'SUBMITTED')
            ->where('provider', $provider->key())
            ->whereNotNull('providerMessageId')
            ->where('updatedAt', '<', now()->subSeconds($pollAfterSeconds)->format('Y-m-d H:i:s.v'))
            ->orderBy('updatedAt')
            ->limit($limit)
            ->get(['id', 'providerMessageId', 'submittedAt']);
        $updated = 0;
        foreach ($candidates as $m) {
            $res = $provider->deliveryStatus($m->providerMessageId);
            if (in_array($res->status, ['UNKNOWN', 'SUBMITTED'], true)) {
                if ($m->submittedAt && $m->submittedAt->lt(CarbonImmutable::now()->subHours(72))) {
                    $this->delivery->apply(['messageId' => $m->id, 'status' => 'EXPIRED', 'source' => 'SYSTEM', 'dedupeKey' => "expire:{$m->id}", 'description' => 'No delivery report received within 72 hours', 'refund' => false]);
                    $updated++;
                } else {
                    Message::query()->whereKey($m->id)->update(['updatedAt' => now()->format('Y-m-d H:i:s.v')]);
                }

                continue;
            }
            $outcome = $this->delivery->apply([
                'messageId' => $m->id, 'status' => $res->status, 'source' => 'PROVIDER_POLL', 'dedupeKey' => "poll:{$m->id}:{$res->status}",
                'occurredAt' => $res->occurredAt, 'providerStatus' => $res->providerStatus, 'errorCode' => $res->errorCode, 'description' => $res->description,
            ]);
            if ($outcome === 'applied') {
                $updated++;
            }
        }

        return ['checked' => $candidates->count(), 'updated' => $updated];
    }
}
