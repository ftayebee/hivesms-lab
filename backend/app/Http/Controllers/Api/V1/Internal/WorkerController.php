<?php

namespace App\Http\Controllers\Api\V1\Internal;

use App\Http\Controllers\Controller;
use App\Services\Messaging\WorkerService;
use App\Support\Crypto;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * POST|GET /api/v1/internal/worker/tick with `Authorization: Bearer <CRON_SECRET>`: one worker
 * cycle, for hosts where only an HTTP cron is available. Prefer `php artisan schedule:run` (same
 * work). Overlapping ticks are safe (atomic claims); a cache lock avoids running two at once.
 */
class WorkerController extends Controller
{
    public function __invoke(Request $request, WorkerService $worker): JsonResponse
    {
        $secret = (string) config('smsflow.cron_secret');
        $token = preg_match('/^Bearer\s+(.+)$/i', (string) $request->header('Authorization'), $m) ? $m[1] : '';
        if ($secret === '' || ! Crypto::safeEqual($secret, $token)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }
        $lock = Cache::lock('sms:worker-tick', 120);
        if (! $lock->get()) {
            return response()->json(['ok' => true, 'skipped' => 'another tick is running']);
        }
        try {
            $summary = $worker->tick(budgetSeconds: (int) config('smsflow.sms.worker_budget_seconds'));
            if (Cache::add('sms:housekeeping', true, 600)) {
                $worker->housekeeping();
            }
        } finally {
            $lock->release();
        }

        return response()->json(['ok' => true] + $summary);
    }
}
