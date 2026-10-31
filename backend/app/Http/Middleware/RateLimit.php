<?php

namespace App\Http\Middleware;

use App\Http\RequestContext;
use App\Services\Auth\SessionService;
use App\Services\Platform\RateLimiter;
use App\Support\ApiResponse;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * DB-backed fixed-window limit (`ratelimit:<rule>` from config/smsflow.php rate_limits). The
 * subject is the API key, else the signed-in user, else the client IP; the bucket is per route,
 * as in the Node handler. Adds X-RateLimit-* headers (and Retry-After on 429).
 */
class RateLimit
{
    public function __construct(private readonly RateLimiter $limiter) {}

    public function handle(Request $request, Closure $next, string $rule): Response
    {
        $subject = $request->attributes->get(RequestContext::API_KEY_ID)
            ?? $request->attributes->get(SessionService::REQUEST_ATTRIBUTE)?->user->id
            ?? RequestContext::ip($request)
            ?? 'anon';
        $route = $request->route()?->uri() ?? $request->path();
        $r = $this->limiter->hit("api:/{$route}:{$subject}", RateLimiter::rule($rule));
        $headers = RateLimiter::headers($r);
        if (! $r['allowed']) {
            $response = ApiResponse::fail(ErrorCode::RATE_LIMITED, 'Too many requests. Slow down and retry after the time in the Retry-After header.');
            $response->headers->add($headers);

            return $response;
        }
        $response = $next($request);
        $response->headers->add($headers);

        return $response;
    }
}
