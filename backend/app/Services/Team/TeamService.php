<?php

namespace App\Services\Team;

use App\Auth\Permissions;
use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Mail\EmailTemplates;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\OrganizationMember;
use App\Models\Permission;
use App\Models\Role;
use App\Models\RolePermission;
use App\Models\User;
use App\Services\Auth\PasswordHasher;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\Mailer;
use App\Services\Platform\NotificationService;
use App\Support\Crypto;
use App\Support\ErrorCode;
use Illuminate\Support\Facades\DB;

/** Team members, invitations and role permissions (port of features/team/service.ts). */
class TeamService
{
    private const INVITE_DAYS = 7;

    public function __construct(
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer,
        private readonly NotificationService $notifications,
        private readonly PasswordHasher $hasher,
    ) {}

    /** @return array{members: mixed, invitations: mixed, roles: list<array<string, mixed>>} */
    public function list(TenantContext $ctx): array
    {
        $ctx->requirePermission('team:read');
        $members = OrganizationMember::query()->where('organizationId', $ctx->organizationId)
            ->with(['user' => fn ($q) => $q->withTrashed()->select(['id', 'name', 'email', 'lastLoginAt', 'emailVerifiedAt']), 'role:id,key,name'])
            ->orderBy('joinedAt')->get();
        $invitations = Invitation::query()->where('organizationId', $ctx->organizationId)->whereNull('acceptedAt')->whereNull('revokedAt')
            ->with('role:id,key,name')->orderByDesc('createdAt')->get();
        $roles = Role::query()->where('organizationId', $ctx->organizationId)->with('grantedPermissions:id,key')->get()
            ->sortBy(fn (Role $r) => array_search($r->key, Permissions::ROLE_ORDER, true))
            ->map(fn (Role $r) => ['id' => $r->id, 'key' => $r->key, 'name' => $r->name, 'description' => $r->description, 'permissions' => $r->grantedPermissions->pluck('key')->values()->all()])
            ->values()->all();

        return ['members' => $members, 'invitations' => $invitations, 'roles' => $roles];
    }

    private function isOwner(TenantContext $ctx): bool
    {
        return $ctx->roleKey === 'OWNER';
    }

    private function ownersCount(string $organizationId): int
    {
        return OrganizationMember::query()->where('organizationId', $organizationId)->where('status', 'ACTIVE')->whereHas('role', fn ($q) => $q->where('key', 'OWNER'))->count();
    }

    private function role(TenantContext $ctx, string $key): Role
    {
        return Role::query()->where('organizationId', $ctx->organizationId)->where('key', $key)->firstOrFail();
    }

    public function invite(TenantContext $ctx, string $email, string $roleKey): Invitation
    {
        $ctx->requirePermission('team:manage');
        if ($roleKey === 'OWNER' && ! $this->isOwner($ctx)) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Only owners can invite another owner.');
        }
        $role = $this->role($ctx, $roleKey);
        if (OrganizationMember::query()->where('organizationId', $ctx->organizationId)->whereHas('user', fn ($q) => $q->where('email', $email))->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'This person is already a member.', ['field' => 'email']);
        }
        $pending = Invitation::query()->where('organizationId', $ctx->organizationId)->whereNull('acceptedAt')->whereNull('revokedAt')->where('expiresAt', '>', now()->format('Y-m-d H:i:s.v'))->count();
        if ($pending >= 50) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Too many pending invitations. Revoke some first.');
        }
        Invitation::query()->where('organizationId', $ctx->organizationId)->where('email', $email)->whereNull('acceptedAt')->whereNull('revokedAt')->update(['revokedAt' => now()->format('Y-m-d H:i:s.v')]);
        $token = Crypto::randomToken(32);
        $inv = Invitation::query()->forceCreate([
            'organizationId' => $ctx->organizationId, 'email' => $email, 'roleId' => $role->id, 'tokenHash' => Crypto::sha256($token),
            'invitedById' => $ctx->userId, 'expiresAt' => now()->addDays(self::INVITE_DAYS),
        ]);
        $orgName = (string) Organization::query()->whereKey($ctx->organizationId)->value('name');
        $inviter = (string) User::query()->whereKey($ctx->userId)->value('name');
        $this->mailer->send($email, EmailTemplates::invitation($orgName, $inviter, $role->name, config('smsflow.frontend_url')."/invite/{$token}"));
        $this->audit->log('team.invite', $ctx->actor(), $ctx->organizationId, 'invitation', $inv->id, ['email' => $email, 'role' => $roleKey]);

        return $inv->load('role:id,key,name');
    }

    public function revokeInvitation(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('team:manage');
        $n = Invitation::query()->whereKey($id)->where('organizationId', $ctx->organizationId)->whereNull('acceptedAt')->whereNull('revokedAt')->update(['revokedAt' => now()->format('Y-m-d H:i:s.v')]);
        if (! $n) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Invitation not found.');
        }
        $this->audit->log('team.invite_revoke', $ctx->actor(), $ctx->organizationId, 'invitation', $id);
    }

    private function member(TenantContext $ctx, string $memberId): OrganizationMember
    {
        return OrganizationMember::query()->with('role:id,key')->where('organizationId', $ctx->organizationId)->whereKey($memberId)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'Member not found.');
    }

    public function changeRole(TenantContext $ctx, string $memberId, string $roleKey): void
    {
        $ctx->requirePermission('team:manage');
        $m = $this->member($ctx, $memberId);
        if ($m->userId === $ctx->userId) {
            throw new AppException(ErrorCode::FORBIDDEN, "You can't change your own role.");
        }
        if (($m->role->key === 'OWNER' || $roleKey === 'OWNER') && ! $this->isOwner($ctx)) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Only owners can grant or remove the owner role.');
        }
        if ($m->role->key === 'OWNER' && $roleKey !== 'OWNER' && $this->ownersCount($ctx->organizationId) <= 1) {
            throw new AppException(ErrorCode::CONFLICT, 'An organization must keep at least one owner.');
        }
        $role = $this->role($ctx, $roleKey);
        $m->forceFill(['roleId' => $role->id])->save();
        $this->audit->log('team.role_change', $ctx->actor(), $ctx->organizationId, 'member', $memberId, ['from' => $m->role->key, 'to' => $roleKey]);
    }

    public function setStatus(TenantContext $ctx, string $memberId, string $action): void
    {
        $ctx->requirePermission('team:manage');
        $m = $this->member($ctx, $memberId);
        if ($m->userId === $ctx->userId) {
            throw new AppException(ErrorCode::FORBIDDEN, "You can't remove or disable yourself.");
        }
        if ($m->role->key === 'OWNER' && ! $this->isOwner($ctx)) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Only owners can remove or disable an owner.');
        }
        if ($m->role->key === 'OWNER' && $action !== 'enable' && $this->ownersCount($ctx->organizationId) <= 1) {
            throw new AppException(ErrorCode::CONFLICT, 'An organization must keep at least one owner.');
        }
        if ($action === 'remove') {
            $m->delete();
        } else {
            $m->forceFill(['status' => $action === 'disable' ? 'DISABLED' : 'ACTIVE'])->save();
        }
        $this->audit->log("team.member_{$action}", $ctx->actor(), $ctx->organizationId, 'member', $memberId, ['userId' => $m->userId]);
    }

    /** @param list<string> $permissions */
    public function updateRolePermissions(TenantContext $ctx, string $roleKey, array $permissions): void
    {
        $ctx->requirePermission('team:manage');
        if ($roleKey === 'OWNER') {
            throw new AppException(ErrorCode::FORBIDDEN, 'The owner role always has every permission.');
        }
        if ($roleKey === 'ADMIN' && ! $this->isOwner($ctx)) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Only owners can change the admin role.');
        }
        $valid = array_values(array_intersect(array_unique($permissions), array_keys(Permissions::ORG)));
        $role = $this->role($ctx, $roleKey);
        $permIds = Permission::query()->whereIn('key', $valid)->pluck('id');
        DB::transaction(function () use ($role, $permIds) {
            RolePermission::query()->where('roleId', $role->id)->delete();
            if ($permIds->isNotEmpty()) {
                RolePermission::query()->insert($permIds->map(fn ($p) => ['roleId' => $role->id, 'permissionId' => $p])->all());
            }
        });
        $this->audit->log('team.role_permissions_update', $ctx->actor(), $ctx->organizationId, 'role', $role->id, ['role' => $roleKey, 'permissions' => $valid]);
    }

    // ─── Accepting invitations ───

    public function findInvitation(string $token): ?Invitation
    {
        $inv = Invitation::query()->with(['organization:id,name,deletedAt', 'role:id,name'])->where('tokenHash', Crypto::sha256($token))->first();
        if (! $inv || $inv->acceptedAt || $inv->revokedAt || $inv->expiresAt->isPast() || ! $inv->organization) {
            return null;
        }

        return $inv;
    }

    public function accept(string $token, User $user): string
    {
        $inv = $this->findInvitation($token) ?? throw new AppException(ErrorCode::INVALID_REQUEST, 'This invitation is invalid or has expired. Ask for a new one.');
        if (strtolower($user->email) !== strtolower($inv->email)) {
            throw new AppException(ErrorCode::FORBIDDEN, "This invitation was sent to {$inv->email}. Sign in with that email address to accept it.");
        }
        DB::transaction(function () use ($inv, $user) {
            if (! Invitation::query()->whereKey($inv->id)->whereNull('acceptedAt')->update(['acceptedAt' => now()->format('Y-m-d H:i:s.v')])) {
                throw new AppException(ErrorCode::CONFLICT, 'This invitation was already used.');
            }
            $existing = OrganizationMember::query()->where('organizationId', $inv->organizationId)->where('userId', $user->id)->first();
            if ($existing) {
                $existing->forceFill(['roleId' => $inv->roleId, 'status' => 'ACTIVE'])->save();
            } else {
                OrganizationMember::query()->forceCreate(['organizationId' => $inv->organizationId, 'userId' => $user->id, 'roleId' => $inv->roleId, 'invitedById' => $inv->invitedById, 'joinedAt' => now()]);
            }
            if (! $user->emailVerifiedAt) {
                $user->forceFill(['emailVerifiedAt' => now()])->save(); // the invitation proves the email
            }
        });
        $this->audit->log('team.join', ['type' => 'USER', 'userId' => $user->id], $inv->organizationId, 'invitation', $inv->id);
        $this->notifications->notify($inv->organizationId, 'team.changed', "{$user->name} joined the team", "{$user->name} accepted the invitation as {$inv->role->name}.", '/dashboard/team');

        return $inv->organizationId;
    }

    /** New account from an invitation link (email comes from the invitation, verified by it). */
    public function createUserForInvitation(string $token, string $name, ?string $phone, string $password): User
    {
        $inv = $this->findInvitation($token) ?? throw new AppException(ErrorCode::INVALID_REQUEST, 'This invitation is invalid or has expired.');
        if (User::withTrashed()->where('email', $inv->email)->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'An account with this email already exists. Sign in to accept the invitation.');
        }
        if ($phone && User::withTrashed()->where('phone', $phone)->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'This mobile number is already registered.', ['field' => 'phone']);
        }
        $user = User::query()->forceCreate(['email' => $inv->email, 'name' => $name, 'phone' => $phone, 'passwordHash' => $this->hasher->hash($password), 'emailVerifiedAt' => now()]);
        $this->audit->log('auth.register', ['type' => 'USER', 'userId' => $user->id], $inv->organizationId, metadata: ['via' => 'invitation']);

        return $user;
    }
}
