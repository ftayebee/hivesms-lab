<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Throwable;

/** GET /api/v1/health: liveness plus a database round trip (for uptime monitors). */
class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        try {
            DB::select('SELECT 1');
        } catch (Throwable $e) {
            report($e);

            return ApiResponse::fail(ErrorCode::INTERNAL_ERROR, 'Database unavailable.', 503);
        }

        return ApiResponse::ok(['status' => 'ok', 'database' => 'ok']);
    }
}
