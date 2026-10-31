<?php

namespace App\Services\Admin;

use App\Auth\AdminContext;
use App\Exceptions\AppException;
use App\Models\User;
use App\Services\Auth\AuthService;
use App\Services\Auth\PasswordHasher;
use App\Services\Auth\SessionService;
use App\Services\Platform\AuditLogger;
use App\Support\Crypto;
use App\Support\ErrorCode;
use Illuminate\Support\Facades\DB;

/**
 * Platform staff administration (SUPER_ADMIN only, `admin:users:manage`). Rules:
 *  - nobody changes their own platform role or status (no self-promotion, no self-lockout);
 *  - the last ACTIVE super admin can be neither demoted nor suspended — the super-admin rows are
 *    locked first, so two owners demoting each other at the same time cannot both succeed;
 *  - every change carries a reason and is audited with before/after in the same transaction;
 *  - a role or status change signs the user out everywhere.
 * Callers confirm the acting admin's password first (PrivilegedActionGuard).
 */
class StaffService
{
    public const STAFF_ROLES = ['SUPPORT', 'ADMIN', 'SUPER_ADMIN'];

    public const ROLES = ['USER', 'SUPPORT', 'ADMIN', 'SUPER_ADMIN'];

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly SessionService $sessions,
        private readonly AuthService $auth,
        private readonly PasswordHasher $hasher,
    ) {}

    public function updateAccess(AdminContext $admin, string $userId, ?string $role, ?string $status, string $reason): User
    {
        if ($userId === $admin->userId) {
            throw new AppException(ErrorCode::FORBIDDEN, "You can't change your own access.");
        }
        if ($role === null && $status === null) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Nothing to change.', ['field' => 'platformRole']);
        }
        $this->assertCanGrant($admin, $role);

        [$user, $before] = DB::transaction(function () use ($admin, $userId, $role, $status, $reason) {
            $this->lockActiveOwners();
            $u = User::query()->lockForUpdate()->find($userId) ?? throw new AppException(ErrorCode::NOT_FOUND, 'User not found.');
            $before = ['platformRole' => $u->platformRole->value, 'status' => $u->status->value];
            $after = array_filter(['platformRole' => $role, 'status' => $status], fn ($v) => $v !== null);
            if (array_intersect_assoc($after, $before) === $after) {
                throw new AppException(ErrorCode::CONFLICT, 'The user already has this access.');
            }
            $losesOwner = $before['platformRole'] === 'SUPER_ADMIN' && $before['status'] === 'ACTIVE'
                && (($role !== null && $role !== 'SUPER_ADMIN') || $status === 'SUSPENDED');
            if ($losesOwner && $this->activeOwnerCount() <= 1) {
                throw new AppException(ErrorCode::CONFLICT, 'At least one active super admin must remain. Promote a replacement first.');
            }
            $u->forceFill($after)->save();
            $this->audit->log('admin.user.access_update', $admin->actor(), null, 'user', $userId, ['before' => $before, 'after' => $after, 'reason' => $reason], $admin->ip, $admin->userAgent);

            return [$u, $before];
        });
        if ($role !== null || $status === 'SUSPENDED') {
            $this->sessions->revokeAllForUser($userId);
        }

        return $user;
    }

    /**
     * Grants a staff role to an existing account, or creates the account (no usable password) and
     * e-mails a single-use set-password link. Staff never choose or see another person's password.
     *
     * @return array{user: User, created: bool}
     */
    public function invite(AdminContext $admin, string $email, string $name, string $role, string $reason): array
    {
        if (! in_array($role, self::STAFF_ROLES, true)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Choose a staff role.', ['field' => 'role']);
        }
        $this->assertCanGrant($admin, $role);
        $email = strtolower(trim($email));
        $existing = User::query()->where('email', $email)->first();
        if ($existing) {
            if ($existing->status->value !== 'ACTIVE') {
                throw new AppException(ErrorCode::CONFLICT, 'This account is suspended. Restore it before granting staff access.', ['field' => 'email']);
            }
            $user = $this->updateAccess($admin, $existing->id, $role, null, $reason);

            return ['user' => $user, 'created' => false];
        }
        $user = DB::transaction(function () use ($admin, $email, $name, $role, $reason) {
            $u = User::query()->forceCreate([
                'email' => $email, 'name' => $name, 'platformRole' => $role, 'status' => 'ACTIVE',
                // Random, never revealed: the person sets their own password through the e-mailed link.
                'passwordHash' => $this->hasher->hash(Crypto::randomToken(48)),
            ]);
            $this->audit->log('admin.staff.invite', $admin->actor(), null, 'user', $u->id, ['email' => $email, 'role' => $role, 'reason' => $reason], $admin->ip, $admin->userAgent);

            return $u;
        });
        $this->auth->sendPasswordResetFor($user);

        return ['user' => $user, 'created' => true];
    }

    /**
     * One-time owner bootstrap (php artisan platform:bootstrap-owner). Refuses while any active
     * super admin exists — later owners are added in the panel by an existing owner.
     *
     * @return array{user: User, created: bool, resetLink: string}
     */
    public function bootstrapOwner(string $email, string $name): array
    {
        $email = strtolower(trim($email));
        $result = DB::transaction(function () use ($email, $name) {
            $this->lockActiveOwners();
            if ($this->activeOwnerCount() > 0) {
                throw new AppException(ErrorCode::CONFLICT, 'An active super admin already exists. Add owners from the admin panel instead.');
            }
            $u = User::query()->lockForUpdate()->where('email', $email)->first();
            $created = ! $u;
            if ($u) {
                if ($u->status->value !== 'ACTIVE') {
                    throw new AppException(ErrorCode::CONFLICT, 'This account is suspended.');
                }
                $before = $u->platformRole->value;
                $u->forceFill(['platformRole' => 'SUPER_ADMIN'])->save();
            } else {
                $before = null;
                $u = User::query()->forceCreate([
                    'email' => $email, 'name' => $name, 'platformRole' => 'SUPER_ADMIN', 'status' => 'ACTIVE',
                    'passwordHash' => $this->hasher->hash(Crypto::randomToken(48)),
                ]);
            }
            $this->audit->log('admin.bootstrap_owner', ['type' => 'SYSTEM'], null, 'user', $u->id, ['created' => $created, 'before' => $before, 'via' => 'artisan']);

            return ['user' => $u, 'created' => $created];
        });
        $this->sessions->revokeAllForUser($result['user']->id);

        return $result + ['resetLink' => $this->auth->createPasswordResetLink($result['user'])];
    }

    public function activeOwnerCount(): int
    {
        return User::query()->where('platformRole', 'SUPER_ADMIN')->where('status', 'ACTIVE')->whereNull('deletedAt')->count();
    }

    /** Defence in depth: only a super admin may grant or revoke owner-level access, whatever the route says. */
    private function assertCanGrant(AdminContext $admin, ?string $role): void
    {
        if ($role !== null && ! in_array($role, self::ROLES, true)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Unknown platform role.', ['field' => 'platformRole']);
        }
        if ($admin->role !== 'SUPER_ADMIN') {
            throw new AppException(ErrorCode::FORBIDDEN, 'Only a super admin can change staff access.');
        }
    }

    private function lockActiveOwners(): void
    {
        User::query()->where('platformRole', 'SUPER_ADMIN')->where('status', 'ACTIVE')->lockForUpdate()->pluck('id');
    }
}
