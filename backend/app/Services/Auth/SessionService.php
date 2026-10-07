<?php

namespace App\Services\Auth;

use App\Auth\ResolvedSession;
use App\Auth\TenantContext;
use App\Models\OrganizationMember;
use App\Models\Session;
use App\Models\User;
use App\Support\Crypto;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

/**
 * Dashboard sessions on the existing `sessions` table (port of src/lib/auth/session-store.ts).
 * The opaque token (32 random bytes, base64url) is handed to the Next.js server, which keeps it
 * in its httpOnly cookie and sends it back as `Authorization: Bearer <token>`. Only sha256(token)
 * is stored, so sessions created by the Node app keep working against Laravel and vice versa.
 */
class SessionService
{
    public const REQUEST_ATTRIBUTE = 'smsflow.session';

    /** @return array{token: string, session: Session} */
    public function create(string $userId, ?string $organizationId, bool $remember, ?string $ip, ?string $userAgent): array
    {
        $token = Crypto::randomToken(32);
        $days = $remember ? config('smsflow.sessions.remember_ttl_days') : config('smsflow.sessions.ttl_days');
        $session = Session::query()->forceCreate([
            'tokenHash' => Crypto::sha256($token),
            'userId' => $userId,
            'activeOrganizationId' => $organizationId,
            'ipAddress' => $ip,
            'userAgent' => $userAgent !== null ? mb_substr($userAgent, 0, 500) : null,
            'expiresAt' => now()->addDays($days),
            'lastSeenAt' => now(),
        ]);

        return ['token' => $token, 'session' => $session];
    }

    public static function bearerToken(Request $request): ?string
    {
        $header = (string) $request->header('Authorization', '');
        if (! preg_match('/^Bearer\s+(\S+)$/i', trim($header), $m)) {
            return null;
        }

        return $m[1];
    }

    /** Resolves (and caches on the request) the session of a dashboard request. */
    public function fromRequest(Request $request): ?ResolvedSession
    {
        if ($request->attributes->has(self::REQUEST_ATTRIBUTE)) {
            return $request->attributes->get(self::REQUEST_ATTRIBUTE);
        }
        $token = self::bearerToken($request);
        $resolved = $token ? $this->resolve($token) : null;
        $request->attributes->set(self::REQUEST_ATTRIBUTE, $resolved);

        return $resolved;
    }

    public function resolve(string $token): ?ResolvedSession
    {
        // API keys are never session tokens; reject without a lookup.
        if ($token === '' || strlen($token) > 200 || str_starts_with($token, 'sfk_')) {
            return null;
        }
        $session = Session::query()->with('user')->where('tokenHash', Crypto::sha256($token))->first();
        if (! $session) {
            return null;
        }
        /** @var User|null $user */
        $user = $session->user;
        $now = CarbonImmutable::now();
        if (! $user || $session->expiresAt <= $now || $user->status->value !== 'ACTIVE' || $user->deletedAt !== null) {
            $session->delete();

            return null;
        }
        // Sessions created before a password change are invalid.
        if ($user->passwordChangedAt && $session->createdAt < $user->passwordChangedAt) {
            $session->delete();

            return null;
        }
        if ($now->diffInSeconds($session->lastSeenAt, true) > config('smsflow.sessions.touch_interval_seconds')) {
            Session::query()->whereKey($session->id)->update(['lastSeenAt' => $now->format('Y-m-d H:i:s.v')]);
        }

        return new ResolvedSession($session->id, $user, $session->activeOrganizationId, CarbonImmutable::instance($session->expiresAt));
    }

    public function revoke(string $sessionId): void
    {
        Session::query()->whereKey($sessionId)->delete();
    }

    public function revokeAllForUser(string $userId, ?string $exceptSessionId = null): void
    {
        Session::query()->where('userId', $userId)->when($exceptSessionId, fn ($q) => $q->where('id', '!=', $exceptSessionId))->delete();
    }

    public function setActiveOrganization(string $sessionId, string $organizationId): void
    {
        Session::query()->whereKey($sessionId)->update(['activeOrganizationId' => $organizationId]);
    }

    /** Membership-based tenant context, or null when the user is not an active member. */
    public function buildTenantContext(string $userId, string $organizationId, ?string $ip = null, ?string $userAgent = null): ?TenantContext
    {
        $m = OrganizationMember::query()
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'status', 'deletedAt']), 'role.grantedPermissions:id,key'])
            ->where('organizationId', $organizationId)
            ->where('userId', $userId)
            ->first();
        if (! $m || $m->status->value !== 'ACTIVE' || ! $m->organization || $m->organization->deletedAt !== null) {
            return null;
        }

        return new TenantContext(
            organizationId: $organizationId,
            organizationStatus: $m->organization->status->value,
            userId: $userId,
            apiKeyId: null,
            roleKey: $m->role->key,
            permissions: $m->role->grantedPermissions->pluck('key')->values()->all(),
            ip: $ip,
            userAgent: $userAgent,
        );
    }

    public function defaultOrganizationFor(string $userId): ?string
    {
        return OrganizationMember::query()
            ->where('userId', $userId)
            ->where('status', 'ACTIVE')
            ->whereHas('organization')
            ->orderBy('joinedAt')
            ->value('organizationId');
    }

    /**
     * Tenant context for a dashboard request: the session's active organization, falling back to
     * the user's first organization (and remembering it on the session).
     */
    public function tenantFor(ResolvedSession $session, ?string $ip, ?string $userAgent): ?TenantContext
    {
        $ctx = $session->activeOrganizationId ? $this->buildTenantContext($session->user->id, $session->activeOrganizationId, $ip, $userAgent) : null;
        if ($ctx) {
            return $ctx;
        }
        $orgId = $this->defaultOrganizationFor($session->user->id);
        if (! $orgId) {
            return null;
        }
        $ctx = $this->buildTenantContext($session->user->id, $orgId, $ip, $userAgent);
        if ($ctx) {
            $this->setActiveOrganization($session->sessionId, $orgId);
        }

        return $ctx;
    }
}
