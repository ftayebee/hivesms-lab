<?php

namespace App\Services\Messaging;

use App\Models\Message;
use App\Services\Platform\SettingsService;
use App\Services\Sms\ProviderResponseRedactor;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SendSmsResult;
use App\Services\Sms\SmsProviderInterface;
use App\Services\Sms\SmsProviderManager;
use App\Support\Phone;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
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
 * again; failInterruptedSends() marks them UNKNOWN (kept charged, listed for staff review) instead
 * of risking a duplicate or refunding a message that may have been delivered. Messages whose lease
 * expired BEFORE the marker was written were never sent and are retried.
 *
 * Campaigns are sent in batches (campaigns.batchSize, 10 or 100 by default):
 * processCampaignBatches() claims one batch per campaign at a time (round-robin by lastBatchAt),
 * numbers it (campaigns.currentBatch → messages.batchNumber) and sends it in chunks of the
 * provider's concurrency limit. The campaign status is re-checked before every chunk: a pause or
 * cancel stops the batch; requests already in flight finish and are recorded, untouched ones are
 * released for later.
 *
 * Every provider answer is written immediately: status, provider id, provider code, a redacted
 * response summary and request/response timestamps (messages + message_events).
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

    /**
     * Leases taken by this instance: message id => the exact lockedUntil value we wrote. The
     * in-flight marker only applies to rows still holding that value, so a row whose lease expired
     * and was re-leased by another worker is never sent by both.
     *
     * @var array<string, string>
     */
    private array $leases = [];

    private const DUE = "m.status = 'QUEUED' AND m.provider IS NULL AND m.nextAttemptAt <= ? AND (m.lockedUntil IS NULL OR m.lockedUntil < ?)";

    /**
     * @param  list<string>|null  $ids  restrict to these messages (inline dispatch)
     * @param  string|null  $campaignId  restrict to one campaign (batch processing)
     * @param  bool  $standaloneOnly  only messages without a campaign
     * @return list<string> claimed message ids
     */
    public function claim(int $limit, ?array $ids = null, ?string $campaignId = null, bool $standaloneOnly = false): array
    {
        if ($ids !== null && ! $ids) {
            return [];
        }
        $claimed = [];
        // Candidates taken by a concurrent claimer are lost at the lock step: re-read a few times.
        for ($round = 0; $round < 4 && count($claimed) < $limit; $round++) {
            $now = now()->format('Y-m-d H:i:s.v');
            $bindings = [$now, $now];
            $filter = '';
            if ($ids) {
                $filter = ' AND m.id IN ('.implode(',', array_fill(0, count($ids), '?')).')';
                $bindings = array_merge($bindings, $ids);
            }
            if ($campaignId !== null) {
                $filter .= ' AND m.campaignId = ?';
                $bindings[] = $campaignId;
            } elseif ($standaloneOnly) {
                $filter .= ' AND m.campaignId IS NULL';
            }
            $bindings[] = $limit - count($claimed);
            $candidates = array_column(DB::select(
                'SELECT m.id FROM messages m WHERE '.self::DUE.'
                   AND (m.campaignId IS NULL OR EXISTS (SELECT 1 FROM campaigns c WHERE c.id = m.campaignId AND c.status = \'PROCESSING\'))
                   AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = m.organizationId AND o.status = \'ACTIVE\')'.$filter.'
                 ORDER BY m.nextAttemptAt, m.queuedAt, m.id LIMIT ?',
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
                foreach ($leased as $id) {
                    $this->leases[$id] = $until;
                }
            }

            return $leased;
        }, 3);
    }

    /** 30s, 1m, 2m, 4m … capped at 30 min, plus jitter. */
    private function backoffSeconds(int $attempt): int
    {
        return (int) min(30 * (2 ** max(0, $attempt - 1)), 1800) + random_int(0, 5);
    }

    /** Messages sent per provider round trip (admin setting, capped by a hard platform maximum). */
    public function concurrencyFor(string $providerKey): int
    {
        $limits = $this->settings->campaignProcessing()['providerConcurrency'];
        $hardMax = (int) config('smsflow.campaign_processing.hardMaxConcurrency', 20);

        return max(1, min($hardMax, (int) ($limits[$providerKey] ?? $limits['default'] ?? 5)));
    }

    /**
     * Sends claimed messages. Must only be called with ids returned by claim().
     *
     * @param  list<string>  $ids
     * @param  string|null  $campaignId  re-checked before every chunk: pause/cancel stops the rest
     * @return array{submitted: int, failed: int, retried: int, unknown: int, released: int}
     */
    public function dispatch(array $ids, ?SmsProviderInterface $provider = null, ?string $campaignId = null): array
    {
        $totals = ['submitted' => 0, 'failed' => 0, 'retried' => 0, 'unknown' => 0, 'released' => 0];
        if (! $ids) {
            return $totals;
        }
        $provider ??= $this->providers->sendingProvider();
        $policy = $this->settings->smsPolicy();
        $throttleMs = (int) $this->settings->campaignProcessing()['throttleMs'];
        $chunks = array_chunk(array_values($ids), $this->concurrencyFor($provider->key()));

        foreach ($chunks as $n => $chunk) {
            if ($campaignId !== null && ! $this->campaignStillSending($campaignId)) {
                $totals['released'] += $this->release(array_merge(...array_slice($chunks, $n)));
                break;
            }
            if ($n > 0) {
                if ($throttleMs > 0) {
                    usleep(min($throttleMs, 5000) * 1000);
                }
                // Earlier chunks took time: keep the remaining leases alive.
                $this->extendLeases(array_merge(...array_slice($chunks, $n)));
            }
            foreach ($this->dispatchChunk($chunk, $provider, $policy) as $k => $v) {
                $totals[$k] += $v;
            }
        }

        return $totals;
    }

    /** @param list<string> $ids */
    private function extendLeases(array $ids): void
    {
        $until = now()->addSeconds((int) config('smsflow.sms.lease_seconds'))->format('Y-m-d H:i:s.v');
        foreach ($this->groupByLease($ids) as $old => $group) {
            if ($old === '') {
                continue;
            }
            $in = implode(',', array_fill(0, count($group), '?'));
            DB::update("UPDATE messages SET lockedUntil = ? WHERE id IN ({$in}) AND lockedUntil = ? AND status = 'QUEUED' AND provider IS NULL", [$until, ...$group, $old]);
            foreach ($group as $id) {
                $this->leases[$id] = $until; // rows we no longer own simply won't match the marker
            }
        }
    }

    /** @return array<string, list<string>> lease value ('' = unknown to this instance) => ids */
    private function groupByLease(array $ids): array
    {
        $groups = [];
        foreach ($ids as $id) {
            $groups[$this->leases[$id] ?? ''][] = $id;
        }

        return $groups;
    }

    private function campaignStillSending(string $campaignId): bool
    {
        return DB::table('campaigns')->where('id', $campaignId)->where('status', 'PROCESSING')->exists();
    }

    /** Gives leased-but-unsent messages back (never touches in-flight ones). */
    private function release(array $ids): int
    {
        if (! $ids) {
            return 0;
        }
        $in = implode(',', array_fill(0, count($ids), '?'));

        return DB::update("UPDATE messages SET lockedUntil = NULL, attempts = GREATEST(attempts - 1, 0), updatedAt = ? WHERE id IN ({$in}) AND status = 'QUEUED' AND provider IS NULL", [now()->format('Y-m-d H:i:s.v'), ...$ids]);
    }

    /** @return array{submitted: int, failed: int, retried: int, unknown: int} */
    private function dispatchChunk(array $ids, SmsProviderInterface $provider, array $policy): array
    {
        // In-flight marker (see class doc). Only rows still QUEUED and leased by us are marked and sent.
        $reqTs = now()->format('Y-m-d H:i:s.v');
        foreach ($this->groupByLease($ids) as $lease => $group) {
            $in = implode(',', array_fill(0, count($group), '?'));
            $own = $lease === '' ? '' : ' AND lockedUntil = ?';
            DB::update("UPDATE messages SET provider = ?, providerRequestedAt = ?, updatedAt = ? WHERE id IN ({$in}) AND status = 'QUEUED' AND provider IS NULL{$own}", [$provider->key(), $reqTs, $reqTs, ...$group, ...($lease === '' ? [] : [$lease])]);
        }
        foreach ($ids as $id) {
            unset($this->leases[$id]);
        }
        $messages = Message::query()->whereIn('id', $ids)->where('status', 'QUEUED')->where('provider', $provider->key())->where('providerRequestedAt', $reqTs)
            ->get(['id', 'to', 'body', 'senderValue', 'senderType', 'smsType', 'encoding', 'attempts'])->values();
        if ($messages->isEmpty()) {
            return ['submitted' => 0, 'failed' => 0, 'retried' => 0, 'unknown' => 0];
        }
        $results = $provider->sendBulk($messages->map(fn (Message $m) => new SendSmsInput(
            $m->id, $m->to, $m->body, $m->senderValue, $m->senderType->value, $m->smsType->value, $m->encoding->value,
        ))->all());
        $respTs = now()->format('Y-m-d H:i:s.v');

        $submitted = $failed = $retried = $unknown = 0;
        foreach ($messages as $i => $m) {
            $r = $results[$i] ?? SendSmsResult::unconfirmed('NO_RESULT', 'The SMS provider adapter returned no result for this message.');
            $summary = ProviderResponseRedactor::summarize($r->raw);
            $fields = [
                'providerStatusCode' => mb_substr((string) ($r->ok ? 'ACCEPTED' : $r->errorCode), 0, 64),
                'providerResponse' => $summary,
                'providerRequestedAt' => $reqTs,
                'providerRespondedAt' => $respTs,
            ];
            try {
                if ($r->ok) {
                    $this->delivery->apply([
                        'messageId' => $m->id, 'status' => 'SUBMITTED', 'source' => 'PROVIDER_RESPONSE', 'dedupeKey' => "submit:{$m->id}",
                        'provider' => $provider->key(), 'providerMessageId' => $r->providerMessageId, 'description' => 'Accepted by provider',
                        'payload' => $summary, 'fields' => $fields,
                    ]);
                    $submitted++;
                } elseif ($r->unconfirmed) {
                    // Possibly accepted by the provider: never resend (duplicate risk), never auto-refund.
                    $this->delivery->apply([
                        'messageId' => $m->id, 'status' => 'UNKNOWN', 'source' => 'PROVIDER_RESPONSE', 'dedupeKey' => "submit-unconfirmed:{$m->id}",
                        'provider' => $provider->key(), 'errorCode' => $r->errorCode, 'payload' => $summary, 'fields' => $fields,
                        'description' => "{$r->errorMessage} Outcome unconfirmed: not resent and not refunded automatically; held for review.",
                    ]);
                    $unknown++;
                    Log::warning('provider outcome unconfirmed, message held for review', ['messageId' => $m->id, 'to' => Phone::mask($m->to), 'code' => $r->errorCode]);
                } elseif ($r->retryable && $m->attempts < $policy['maxAttempts']) {
                    Message::query()->whereKey($m->id)->where('status', 'QUEUED')->update([
                        'provider' => null, // certainly not sent: claimable again
                        'lockedUntil' => null,
                        'nextAttemptAt' => now()->addSeconds($this->backoffSeconds($m->attempts))->format('Y-m-d H:i:s.v'),
                        'errorCode' => mb_substr((string) $r->errorCode, 0, 255),
                        'errorMessage' => $r->errorMessage,
                        'providerStatusCode' => $fields['providerStatusCode'],
                        'providerResponse' => $summary !== null ? json_encode($summary, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
                        'providerRespondedAt' => $respTs,
                    ]);
                    $retried++;
                    Log::warning('provider send failed, will retry', ['messageId' => $m->id, 'to' => Phone::mask($m->to), 'attempt' => $m->attempts, 'code' => $r->errorCode]);
                } else {
                    // Permanent failure, or transient failures exhausted: no infinite retries.
                    $this->delivery->apply([
                        'messageId' => $m->id, 'status' => $r->retryable ? 'FAILED' : 'REJECTED', 'source' => 'PROVIDER_RESPONSE',
                        'dedupeKey' => "submit-fail:{$m->id}", 'provider' => $provider->key(), 'errorCode' => $r->errorCode,
                        'description' => $r->retryable ? "{$r->errorMessage} (gave up after {$m->attempts} attempts)" : $r->errorMessage,
                        'payload' => $summary, 'fields' => $fields,
                    ]);
                    $failed++;
                }
            } catch (Throwable $e) {
                Log::error('error recording dispatch result', ['messageId' => $m->id, 'error' => $e->getMessage()]);
            }
        }

        return ['submitted' => $submitted, 'failed' => $failed, 'retried' => $retried, 'unknown' => $unknown];
    }

    /**
     * Messages whose send started (in-flight marker set) but whose worker died before recording
     * the provider's answer. Their outcome is unknown, so they become UNKNOWN (kept charged, never
     * resent, listed for staff review). Only rows whose lease expired are touched.
     */
    public function failInterruptedSends(int $limit = 200): int
    {
        $ids = Message::query()->where('status', 'QUEUED')->whereNotNull('provider')
            ->where('lockedUntil', '<', now()->format('Y-m-d H:i:s.v'))->limit($limit)->pluck('id');
        foreach ($ids as $id) {
            $this->delivery->apply([
                'messageId' => $id, 'status' => 'UNKNOWN', 'source' => 'SYSTEM', 'dedupeKey' => "send-interrupted:{$id}", 'errorCode' => 'SEND_INTERRUPTED',
                'description' => 'Sending was interrupted before the provider answered. Not resent (duplicate risk) and not refunded automatically; held for review.',
            ]);
            Log::warning('interrupted send held for review', ['messageId' => $id]);
        }

        return $ids->count();
    }

    /**
     * One dispatch cycle for messages that do not belong to a campaign (API and single sends);
     * campaign messages go through processCampaignBatches(). Nothing is claimed if sending is
     * unavailable.
     */
    public function processQueue(int $batchSize = 100): array
    {
        $empty = ['claimed' => 0, 'submitted' => 0, 'failed' => 0, 'retried' => 0, 'unknown' => 0, 'released' => 0];
        if (! $this->providers->sendingAvailable()) {
            Log::error('SMS sending unavailable: the configured provider cannot be used in this environment; messages stay queued');

            return $empty;
        }
        $this->failInterruptedSends();
        $ids = $this->claim($batchSize, null, null, true);
        if (! $ids) {
            return $empty;
        }

        return ['claimed' => count($ids)] + $this->dispatch($ids);
    }

    /**
     * Sends campaign messages in batches: at most $maxBatches batches this call, one batch per
     * campaign per round, campaigns that waited longest first. A per-campaign lock keeps two workers
     * from running batches of the same campaign at the same time (the message leases already make a
     * double send impossible; the lock keeps batch numbering and provider concurrency honest).
     *
     * @param  list<string>|null  $onlyCampaignIds
     * @return array{batches: int, claimed: int, submitted: int, failed: int, retried: int, unknown: int, released: int}
     */
    public function processCampaignBatches(int $maxBatches, float $deadline = INF, ?array $onlyCampaignIds = null): array
    {
        $totals = ['batches' => 0, 'claimed' => 0, 'submitted' => 0, 'failed' => 0, 'retried' => 0, 'unknown' => 0, 'released' => 0];
        if ($maxBatches <= 0 || ! $this->providers->sendingAvailable()) {
            return $totals;
        }
        $this->failInterruptedSends();
        $provider = $this->providers->sendingProvider();
        $exhausted = [];
        while ($totals['batches'] < $maxBatches && microtime(true) < $deadline) {
            $campaigns = DB::table('campaigns')->where('status', 'PROCESSING')
                ->when($onlyCampaignIds !== null, fn ($q) => $q->whereIn('id', $onlyCampaignIds))
                ->when($exhausted, fn ($q) => $q->whereNotIn('id', array_keys($exhausted)))
                ->whereExists(fn ($q) => $q->from('organizations')->whereColumn('organizations.id', 'campaigns.organizationId')->where('organizations.status', 'ACTIVE'))
                ->orderByRaw('lastBatchAt IS NOT NULL, lastBatchAt')->limit(20)->get(['id', 'batchSize']);
            if ($campaigns->isEmpty()) {
                break;
            }
            $progress = false;
            foreach ($campaigns as $c) {
                if ($totals['batches'] >= $maxBatches || microtime(true) >= $deadline) {
                    break;
                }
                $r = $this->runCampaignBatch($c->id, max(1, (int) $c->batchSize), $provider);
                if ($r === null) {
                    $exhausted[$c->id] = true; // nothing due now, or another worker holds the campaign

                    continue;
                }
                $progress = true;
                $totals['batches']++;
                foreach ($r as $k => $v) {
                    $totals[$k] += $v;
                }
            }
            if (! $progress) {
                break;
            }
        }

        return $totals;
    }

    /** @return array{claimed: int, submitted: int, failed: int, retried: int, unknown: int, released: int}|null null = nothing claimed */
    private function runCampaignBatch(string $campaignId, int $batchSize, SmsProviderInterface $provider): ?array
    {
        $lock = Cache::lock("campaign-batch:{$campaignId}", (int) config('smsflow.sms.lease_seconds'));
        if (! $lock->get()) {
            return null;
        }
        try {
            $ids = $this->claim($batchSize, null, $campaignId);
            if (! $ids) {
                return null;
            }
            $batch = DB::transaction(function () use ($campaignId, $ids) {
                $row = DB::selectOne('SELECT currentBatch FROM campaigns WHERE id = ? FOR UPDATE', [$campaignId]);
                $next = (int) ($row->currentBatch ?? 0) + 1;
                $ts = now()->format('Y-m-d H:i:s.v');
                DB::update('UPDATE campaigns SET currentBatch = ?, lastBatchAt = ?, updatedAt = ? WHERE id = ?', [$next, $ts, $ts, $campaignId]);
                $in = implode(',', array_fill(0, count($ids), '?'));
                // A retried message keeps the number of the batch it was first sent in.
                DB::update("UPDATE messages SET batchNumber = ? WHERE id IN ({$in}) AND batchNumber IS NULL", [$next, ...$ids]);

                return $next;
            });
            Log::info('campaign batch', ['campaignId' => $campaignId, 'batch' => $batch, 'size' => count($ids)]);

            return ['claimed' => count($ids)] + $this->dispatch($ids, $provider, $campaignId);
        } finally {
            $lock->release();
        }
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
     * (the provider accepted the message). Providers without delivery reports are never polled:
     * their messages keep the last known status, "Accepted by provider".
     */
    public function pollDeliveryStatuses(int $limit = 200): array
    {
        if (! $this->providers->sendingAvailable()) {
            return ['checked' => 0, 'updated' => 0]; // e.g. mock in production: never fake deliveries
        }
        $provider = $this->providers->sendingProvider();
        if (! $provider->hasDeliveryReports()) {
            return ['checked' => 0, 'updated' => 0]; // polling would only expire accepted messages at 72 h
        }
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
