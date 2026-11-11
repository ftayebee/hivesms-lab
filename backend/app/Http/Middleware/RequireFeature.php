<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate for modules that ship disabled (config smsflow.features.*, docs/23): `feature:dynamic_sms`.
 * Disabled → FEATURE_DISABLED before anything else runs.
 */
class RequireFeature
{
    public function handle(Request $request, Closure $next, string $feature): Response
    {
        if (! config("smsflow.features.{$feature}")) {
            throw new AppException(ErrorCode::FEATURE_DISABLED, 'This feature is not enabled.');
        }

        return $next($request);
    }
}
