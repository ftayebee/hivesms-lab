<?php

namespace App\Http;

use App\Auth\AdminContext;
use App\Auth\ResolvedSession;
use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Services\Auth\SessionService;
use App\Support\ErrorCode;
use Illuminate\Http\Request;

/** Typed access to the identities that middleware attached to the request. */
final class RequestContext
{
    public const TENANT = 'smsflow.tenant';

    public const ADMIN = 'smsflow.admin';

    public const API_KEY_ID = 'smsflow.apiKeyId';

    public const API_SCOPES = 'smsflow.apiScopes';

    public static function session(Request $request): ResolvedSession
    {
        return $request->attributes->get(SessionService::REQUEST_ATTRIBUTE)
            ?? throw new AppException(ErrorCode::UNAUTHORIZED, 'Sign in to continue.');
    }

    public static function tenant(Request $request): TenantContext
    {
        return $request->attributes->get(self::TENANT)
            ?? throw new AppException(ErrorCode::FORBIDDEN, 'No active organization.');
    }

    public static function maybeTenant(Request $request): ?TenantContext
    {
        return $request->attributes->get(self::TENANT);
    }

    public static function admin(Request $request): AdminContext
    {
        return $request->attributes->get(self::ADMIN)
            ?? throw new AppException(ErrorCode::FORBIDDEN, 'Administrator access required.');
    }

    /** Client IP. Behind a proxy, configure TRUSTED_PROXIES so this is the real client address. */
    public static function ip(Request $request): ?string
    {
        return $request->ip();
    }

    public static function userAgent(Request $request): ?string
    {
        $ua = $request->userAgent();

        return $ua !== null ? mb_substr($ua, 0, 500) : null;
    }
}
