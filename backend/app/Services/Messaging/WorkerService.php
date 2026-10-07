<?php

namespace App\Services\Messaging;

use App\Models\IdempotencyKey;
use App\Models\Message;
use App\Models\Payment;
use App\Models\Session;
use App\Models\VerificationToken;
use App\Services\Campaign\CampaignRunner;
use App\Services\Platform\RateLimiter;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * One unit of background work (port of services/messaging/worker.ts). Safe to run concurrently
 * from several processes: every step uses atomic claims. Scheduled every minute.
 */
class WorkerService
{
    public function __construct(
        private readonly CampaignRunner $campaigns,
        private readonly DispatcherService $dispatcher,
        private readonly DeliveryService $delivery,
        private readonly OutboundWebhookService $webhooks,
        private readonly RateLimiter $rateLimiter,
    ) {}

    /** @return array<string, int> */
    public function tick(?int $maxBatches = null, ?int $batchSize = null, ?int $budgetSeconds = null): array
    {
        $started = microtime(true);
        // Heartbeat for /internal/ready: proves the cron/scheduler really runs in production.
        Cache::put('sms:worker:last-tick', time(), 86400);
        $deadline = $budgetSeconds ? $started + $budgetSeconds : INF;

        $launched = 0;
        foreach ($this->campaigns->dueCampaignIds() as $id) {
            // Inline here (we are already in the background); the claim makes double launches impossible.
            $launched += (int) ($this->campaigns->launch($id)['launched'] ?? false);
        }

        $claimed = $submitted = 0;
        $maxBatches ??= (int) config('smsflow.sms.worker_max_batches');
        $batchSize ??= (int) config('smsflow.sms.worker_batch_size');
        for ($i = 0; $i < $maxBatches; $i++) {
            $r = $this->dispatcher->processQueue($batchSize);
            $claimed += $r['claimed'];
            $submitted += $r['submitted'];
            if ($r['claimed'] === 0 || microtime(true) > $deadline) {
                break;
            }
        }

        $this->cancelLeftoverMessages();
        $polled = $this->dispatcher->pollDeliveryStatuses();
        $completed = $this->campaigns->finalize();
        $hooks = $this->webhooks->deliverPending();

        $summary = [
            'campaignsLaunched' => $launched,
            'claimed' => $claimed,
            'submitted' => $submitted,
            'statusUpdates' => $polled['updated'],
            'campaignsCompleted' => $completed,
            'webhooksDelivered' => $hooks['delivered'],
            'ms' => (int) round((microtime(true) - $started) * 1000),
        ];
        if ($claimed || $polled['updated'] || $launched || $completed || $hooks['processed']) {
            Log::info('worker tick', $summary);
        }

        return $summary;
    }

    /** Cancelled campaigns may still have queued messages (large sends): cancel and refund them. */
    private function cancelLeftoverMessages(): void
    {
        $ids = Message::query()->where('status', 'QUEUED')->whereHas('campaign', fn ($q) => $q->withTrashed()->where('status', 'CANCELLED'))->limit(500)->pluck('id');
        foreach ($ids as $id) {
            $this->delivery->apply(['messageId' => $id, 'status' => 'CANCELLED', 'source' => 'SYSTEM', 'dedupeKey' => "cancel:{$id}", 'description' => 'Campaign cancelled']);
        }
    }

    /** Periodic cleanup of expired rows (scheduled every 10 minutes). */
    public function housekeeping(): array
    {
        $now = now()->format('Y-m-d H:i:s.v');
        // Online payments never completed expire after 48 h (manual transfers wait for an admin).
        $expired = Payment::query()->where('status', 'PENDING')->where('provider', '!=', 'manual')
            ->where('createdAt', '<', now()->subHours(48)->format('Y-m-d H:i:s.v'))
            ->update(['status' => 'CANCELLED', 'failureReason' => 'Expired: payment was not completed within 48 hours']);
        $summary = [
            'payments' => $expired,
            'sessions' => Session::query()->where('expiresAt', '<', $now)->delete(),
            'rateLimits' => $this->rateLimiter->purgeExpired(),
            'idempotencyKeys' => IdempotencyKey::query()->where('expiresAt', '<', $now)->delete(),
            'tokens' => VerificationToken::query()->where('expiresAt', '<', now()->subDays(7)->format('Y-m-d H:i:s.v'))->delete(),
        ];
        Log::info('housekeeping', $summary);

        return $summary;
    }
}
