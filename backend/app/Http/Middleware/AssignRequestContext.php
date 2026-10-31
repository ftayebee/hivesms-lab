<?php

namespace App\Http\Middleware;

use App\Support\ApiResponse;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * First middleware on every API request: assigns the request id (generated server-side, never
 * taken from the client), shares it with every log line written during the request, and adds
 * baseline security headers. The id is returned as X-Request-Id and meta.requestId.
 */
class AssignRequestContext
{
    public const CLIENT_IP_HEADER = 'X-SMSFlow-Client-IP';

    public const PROXY_SECRET_HEADER = 'X-SMSFlow-Proxy-Secret';

    public function handle(Request $request, Closure $next): Response
    {
        $this->applyForwardedClientIp($request);
        $requestId = ApiResponse::requestId();
        Log::withContext(['requestId' => $requestId]);

        $response = $next($request);

        $response->headers->set('X-Request-Id', $requestId);
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('Referrer-Policy', 'no-referrer');
        $response->headers->set('X-Frame-Options', 'DENY');
        if (! $response->headers->has('Cache-Control') || str_contains((string) $response->headers->get('Cache-Control'), 'no-cache, private')) {
            $response->headers->set('Cache-Control', 'no-store');
        }

        return $response;
    }

    /**
     * The Next.js server calls this API server-to-server, so the TCP peer is the Next.js host. When
     * it proves itself with FRONTEND_PROXY_SECRET, the browser's IP it forwards becomes the request IP
     * (rate limits, audit logs). Anyone else's header is ignored. Both headers are then removed.
     */
    private function applyForwardedClientIp(Request $request): void
    {
        $secret = (string) config('smsflow.frontend_proxy_secret');
        $given = (string) $request->headers->get(self::PROXY_SECRET_HEADER, '');
        $ip = trim((string) $request->headers->get(self::CLIENT_IP_HEADER, ''));
        $request->headers->remove(self::PROXY_SECRET_HEADER);
        $request->headers->remove(self::CLIENT_IP_HEADER);
        if ($secret === '' || $given === '' || ! hash_equals($secret, $given) || ! filter_var($ip, FILTER_VALIDATE_IP)) {
            return;
        }
        // REMOTE_ADDR is not a trusted proxy, so Request::ip() returns it as-is.
        $request->server->set('REMOTE_ADDR', $ip);
        $request->headers->remove('X-Forwarded-For');
    }
}
