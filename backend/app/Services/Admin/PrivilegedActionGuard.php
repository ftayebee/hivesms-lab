<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\User;
use App\Services\Auth\PasswordHasher;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\RateLimiter;
use App\Support\ErrorCode;
use Illuminate\Support\Facades\Cache;

/**
 * Re-authentication for highly sensitive admin actions (staff access, wallet adjustments, refunds,
 * provider costs): the staff member confirms their current password on every such request, so a
 * stolen session alone cannot move money or grant privileges.
 *
 *  - Five wrong passwords within 15 minutes lock privileged actions for that staff user for
 *    15 minutes (and are audited); the session itself is not touched.
 *  - Privileged mutations are rate-limited per staff user (20 / 10 min).
 *  - The password is never logged, stored or echoed.
 */
class PrivilegedActionGuard
{
    private const LOCK_SECONDS = 900;

    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly RateLimiter $rateLimiter,
        private readonly AuditLogger $audit,
    ) {}

    public function confirm(AdminContext $admin, ?string $password): void
    {
        $limit = $this->rateLimiter->hit("admin-privileged:{$admin->userId}", RateLimiter::rule('admin_privileged_per_user'));
        if (! $limit['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many privileged changes in a short time. Try again in a few minutes.');
        }
        $lockKey = "admin-reauth-locked:{$admin->userId}";
        if (Cache::has($lockKey)) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many wrong passwords. Privileged actions are locked for 15 minutes.');
        }
        $hash = User::query()->whereKey($admin->userId)->value('passwordHash');
        if ($password === null || $password === '' || ! $hash || ! $this->hasher->verify((string) $hash, $password)) {
            $failures = $this->rateLimiter->hit("admin-reauth-fail:{$admin->userId}", RateLimiter::rule('admin_reauth_failures'));
            $this->audit->log('admin.reauth.failed', $admin->actor(), targetType: 'user', targetId: $admin->userId, ip: $admin->ip, userAgent: $admin->userAgent);
            if (! $failures['allowed'] || $failures['remaining'] === 0) {
                Cache::put($lockKey, true, self::LOCK_SECONDS);
                $this->audit->log('admin.reauth.locked', $admin->actor(), targetType: 'user', targetId: $admin->userId, ip: $admin->ip, userAgent: $admin->userAgent);
            }
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Confirm with your current password.', ['field' => 'currentPassword']);
        }
    }
}
