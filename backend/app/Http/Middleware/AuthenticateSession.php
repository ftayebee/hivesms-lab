<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use App\Services\Auth\SessionService;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Dashboard authentication: `Authorization: Bearer <session token>` resolved against the existing
 * `sessions` table (expiry, user status, password-change invalidation). Bearer tokens are not
 * sent automatically by browsers, so these endpoints are not exposed to CSRF.
 */
class AuthenticateSession
{
    public function __construct(private readonly SessionService $sessions) {}

    public function handle(Request $request, Closure $next): Response
    {
        $session = $this->sessions->fromRequest($request);
        if (! $session) {
            throw new AppException(ErrorCode::UNAUTHORIZED, 'Sign in to continue.');
        }
        $request->setUserResolver(fn () => $session->user);

        return $next($request);
    }
}
