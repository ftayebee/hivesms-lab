<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Services\Platform\ReadinessService;
use App\Support\ApiResponse;
use App\Support\Crypto;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Throwable;

class HealthController extends Controller
{
    /** GET /api/v1/health: public liveness + database round trip. No infrastructure details. */
    public function __invoke(): JsonResponse
    {
        try {
            DB::select('SELECT 1');
        } catch (Throwable $e) {
            report($e);

            return ApiResponse::fail(ErrorCode::INTERNAL_ERROR, 'Service unavailable.', 503);
        }

        return ApiResponse::ok(['status' => 'ok', 'database' => 'ok']);
    }

    /**
     * GET /api/v1/internal/ready with `Authorization: Bearer <CRON_SECRET>`: dependency checks for
     * monitoring (database, cache, queue backlog, stuck messages, required secrets, SMS provider).
     * Reports only ok/fail per check — never hosts, credentials or versions. 503 when not ready.
     */
    public function ready(Request $request, ReadinessService $readiness): JsonResponse
    {
        $secret = (string) config('smsflow.cron_secret');
        $token = preg_match('/^Bearer\s+(.+)$/i', (string) $request->header('Authorization'), $m) ? $m[1] : '';
        if ($secret === '' || ! Crypto::safeEqual($secret, $token)) {
            return ApiResponse::fail(ErrorCode::UNAUTHORIZED, 'Authentication required.');
        }
        ['ok' => $ok, 'checks' => $checks] = $readiness->run();

        return $ok ? ApiResponse::ok(['status' => 'ready', 'checks' => $checks]) : ApiResponse::fail(ErrorCode::PROVIDER_NOT_CONFIGURED, 'Not ready.', 503, ['checks' => $checks]);
    }
}
