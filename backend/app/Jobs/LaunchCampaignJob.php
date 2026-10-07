<?php

namespace App\Jobs;

use App\Models\Message;
use App\Services\Campaign\CampaignRunner;
use App\Services\Messaging\DispatcherService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Launches a due SCHEDULED campaign (charge once, queue its messages), then sends small campaigns
 * immediately. The launch claims SCHEDULED → PROCESSING atomically, so retries and the scheduled
 * worker can never charge or queue a campaign twice. Unique per campaign while queued.
 */
class LaunchCampaignJob implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    public int $tries = 3;

    /** @var list<int> */
    public array $backoff = [10, 60];

    public int $timeout = 300;

    public int $uniqueFor = 600;

    public function __construct(public readonly string $campaignId) {}

    public function uniqueId(): string
    {
        return $this->campaignId;
    }

    public function handle(CampaignRunner $runner, DispatcherService $dispatcher): void
    {
        $r = $runner->launch($this->campaignId);
        if (($r['launched'] ?? false) && ($r['messages'] ?? 0) <= (int) config('smsflow.sms.inline_dispatch_max')) {
            $ids = Message::query()->where('campaignId', $this->campaignId)->where('status', 'QUEUED')->pluck('id')->all();
            $dispatcher->dispatchNow($ids);
        }
    }
}
