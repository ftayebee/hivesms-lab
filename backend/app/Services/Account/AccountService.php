<?php

namespace App\Services\Account;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\Notification;
use App\Models\NotificationPreference;
use App\Models\Organization;
use App\Models\OrganizationMember;
use App\Models\Session;
use App\Models\User;
use App\Services\Auth\SessionService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Support\ErrorCode;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

/** Profile, organization settings, sessions, notifications (port of features/settings/service.ts). */
class AccountService
{
    public function __construct(private readonly AuditLogger $audit, private readonly SessionService $sessions) {}

    /** @param array{name: string, phone: ?string, locale: string} $input */
    public function updateProfile(User $user, array $input): User
    {
        $phoneChanged = $input['phone'] !== $user->phone;
        if ($input['phone'] && $phoneChanged && User::withTrashed()->where('phone', $input['phone'])->where('id', '!=', $user->id)->exists()) {
            throw new AppException(ErrorCode::CONFLICT, 'This mobile number is used by another account.', ['field' => 'phone']);
        }
        $user->forceFill(['name' => $input['name'], 'phone' => $input['phone'], 'locale' => $input['locale']] + ($phoneChanged ? ['phoneVerifiedAt' => null] : []))->save();
        $this->audit->log('user.profile_update', ['type' => 'USER', 'userId' => $user->id], metadata: ['phoneChanged' => $phoneChanged]);

        return $user;
    }

    public function updateLocale(User $user, string $locale): void
    {
        $user->forceFill(['locale' => $locale])->save();
    }

    public function organization(TenantContext $ctx): Organization
    {
        return Organization::query()->with('pricingPlan:id,name,key')->findOrFail($ctx->organizationId);
    }

    /** @param array{name: string, industry: ?string, website: ?string, address: ?string, billingEmail: ?string, taxId: ?string} $input */
    public function updateOrganization(TenantContext $ctx, array $input): Organization
    {
        $ctx->requirePermission('settings:manage');
        $org = Organization::query()->findOrFail($ctx->organizationId);
        $org->forceFill($input)->save();
        $this->audit->log('organization.update', $ctx->actor(), $ctx->organizationId, metadata: ['fields' => array_keys($input)]);

        return $this->organization($ctx);
    }

    /** All organizations the user can switch to. */
    public function organizations(User $user): array
    {
        return OrganizationMember::query()->where('userId', $user->id)->where('status', 'ACTIVE')->whereHas('organization')
            ->with(['organization:id,name,slug,status', 'role:id,key,name'])->orderBy('joinedAt')->get()
            ->map(fn (OrganizationMember $m) => ['id' => $m->organization->id, 'name' => $m->organization->name, 'slug' => $m->organization->slug, 'status' => $m->organization->status->value, 'role' => $m->role->key, 'roleName' => $m->role->name])
            ->all();
    }

    public function listSessions(User $user)
    {
        return Session::query()->where('userId', $user->id)->where('expiresAt', '>', now()->format('Y-m-d H:i:s.v'))
            ->orderByDesc('lastSeenAt')->get(['id', 'ipAddress', 'userAgent', 'createdAt', 'lastSeenAt', 'expiresAt']);
    }

    public function revokeSession(User $user, string $sessionId, string $currentSessionId): void
    {
        if ($sessionId === $currentSessionId) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Use Sign out to end your current session.');
        }
        if (! Session::query()->whereKey($sessionId)->where('userId', $user->id)->exists()) {
            throw new AppException(ErrorCode::NOT_FOUND, 'Session not found.');
        }
        $this->sessions->revoke($sessionId);
        $this->audit->log('auth.session_revoke', ['type' => 'USER', 'userId' => $user->id], metadata: ['sessionId' => $sessionId]);
    }

    /** @return list<array{type: string, label: string, inApp: bool, email: bool}> */
    public function notificationPreferences(User $user): array
    {
        $rows = NotificationPreference::query()->where('userId', $user->id)->get()->keyBy('type');

        return array_map(fn ($type) => [
            'type' => $type,
            'label' => NotificationService::TYPES[$type][0],
            'inApp' => $rows[$type]->inApp ?? true,
            'email' => $rows[$type]->email ?? NotificationService::TYPES[$type][2],
        ], array_keys(NotificationService::TYPES));
    }

    /** @param list<array{type: string, inApp: bool, email: bool}> $prefs */
    public function saveNotificationPreferences(User $user, array $prefs): void
    {
        DB::transaction(function () use ($user, $prefs) {
            foreach ($prefs as $p) {
                if (! isset(NotificationService::TYPES[$p['type']])) {
                    continue;
                }
                $row = NotificationPreference::query()->where('userId', $user->id)->where('type', $p['type'])->first();
                if ($row) {
                    $row->forceFill(['inApp' => $p['inApp'], 'email' => $p['email']])->save();
                } else {
                    NotificationPreference::query()->forceCreate(['userId' => $user->id, 'type' => $p['type'], 'inApp' => $p['inApp'], 'email' => $p['email']]);
                }
            }
        });
    }

    public function leaveOrganization(TenantContext $ctx): void
    {
        if (! $ctx->userId) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Not allowed.');
        }
        if ($ctx->roleKey === 'OWNER') {
            $owners = OrganizationMember::query()->where('organizationId', $ctx->organizationId)->where('status', 'ACTIVE')->whereHas('role', fn ($q) => $q->where('key', 'OWNER'))->count();
            if ($owners <= 1) {
                throw new AppException(ErrorCode::CONFLICT, 'You are the only owner. Make someone else an owner before leaving.');
            }
        }
        OrganizationMember::query()->where('organizationId', $ctx->organizationId)->where('userId', $ctx->userId)->delete();
        $this->audit->log('team.leave', $ctx->actor(), $ctx->organizationId);
    }

    /** @return array{page: LengthAwarePaginator, unread: int} */
    public function notifications(TenantContext $ctx, int $page): array
    {
        $q = Notification::query()->where('userId', $ctx->userId)->where('organizationId', $ctx->organizationId);

        return [
            'page' => (clone $q)->orderByDesc('createdAt')->paginate(30, ['*'], 'page', $page),
            'unread' => (clone $q)->whereNull('readAt')->count(),
        ];
    }

    /** @param list<string>|null $ids */
    public function markNotificationsRead(TenantContext $ctx, ?array $ids): int
    {
        return Notification::query()->where('userId', $ctx->userId)->where('organizationId', $ctx->organizationId)->whereNull('readAt')
            ->when($ids !== null, fn ($q) => $q->whereIn('id', $ids))
            ->update(['readAt' => now()->format('Y-m-d H:i:s.v')]);
    }
}
