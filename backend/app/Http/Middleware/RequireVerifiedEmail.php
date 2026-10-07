<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use App\Http\RequestContext;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Sending from the dashboard requires a verified email address (as in tenantAction requireVerifiedEmail). */
class RequireVerifiedEmail
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! RequestContext::session($request)->user->emailVerifiedAt) {
            throw new AppException(ErrorCode::EMAIL_NOT_VERIFIED, 'Verify your email address before sending messages. Check your inbox or resend the link from the banner.');
        }

        return $next($request);
    }
}
