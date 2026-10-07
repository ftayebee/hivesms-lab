<?php

namespace App\Http\Middleware;

use App\Auth\AdminContext;
use App\Auth\Permissions;
use App\Exceptions\AppException;
use App\Http\RequestContext;
use App\Support\ErrorCode;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Platform staff authorization (`platform:admin:customers:manage`). Customers (platform role USER)
 * never pass, whatever their organization role. Use after `auth.session`.
 */
class RequirePlatformPermission
{
    public function handle(Request $request, Closure $next, string $permission = 'admin:access'): Response
    {
        $user = RequestContext::session($request)->user;
        $role = $user->platformRole->value;
        if (! Permissions::platformCan($role, 'admin:access')) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Administrator access required.');
        }
        if (! Permissions::platformCan($role, $permission)) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Your staff role does not allow this action.');
        }
        $request->attributes->set(RequestContext::ADMIN, new AdminContext($user->id, $user->name, $role, RequestContext::ip($request), RequestContext::userAgent($request)));

        return $next($request);
    }
}
