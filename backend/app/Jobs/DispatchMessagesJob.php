<?php

namespace App\Jobs;

use App\Services\Messaging\DispatcherService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Sends specific QUEUED messages right away (API sends, small campaigns). Usually dispatched
 * after the HTTP response. Idempotent by construction: messages are leased before sending, so a
 * retry — or the scheduled worker running at the same time — can never send a message twice.
 * Anything not sent here is picked up by the scheduled worker, so one attempt is enough.
 */
class DispatchMessagesJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;

    public int $tries = 1;

    public int $timeout = 120;

    /** @param list<string> $messageIds */
    public function __construct(public readonly array $messageIds) {}

    public function handle(DispatcherService $dispatcher): void
    {
        $dispatcher->dispatchNow($this->messageIds);
    }

    /** Dispatch after the response when inline dispatch is enabled (otherwise the worker sends them). */
    public static function afterResponse(array $messageIds): void
    {
        if ($messageIds && config('smsflow.sms.inline_dispatch')) {
            self::dispatchAfterResponse(array_values($messageIds));
        }
    }
}
