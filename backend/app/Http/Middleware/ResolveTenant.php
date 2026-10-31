<?php

namespace App\Http\Middleware;

use App\Exceptions\AppException;
use App\Http\RequestContext;
use App\Services\Auth\SessionService;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Builds the tenant context of a dashboard request from the session's active organization (never
 * from client input) and enforces organization permissions: `tenant:contacts:read` or several,
 * comma-separated (`tenant:campaigns:write,sms:send`). Use after `auth.session`.
 */
class ResolveTenant
{
    public function __construct(private readonly SessionService $sessions) {}

    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $session = RequestContext::session($request);
        $ctx = $this->sessions->tenantFor($session, RequestContext::ip($request), RequestContext::userAgent($request));
        if (! $ctx) {
            throw new AppException(ErrorCode::FORBIDDEN, 'No active organization.');
        }
        if ($permissions) {
            $ctx->requirePermission($permissions);
        }
        $request->attributes->set(RequestContext::TENANT, $ctx);

        return $next($request);
    }
}
