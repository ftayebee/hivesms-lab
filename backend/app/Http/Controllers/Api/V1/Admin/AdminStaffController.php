<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Auth\Permissions;
use App\Exceptions\AppException;
use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Admin\StaffAccessRequest;
use App\Http\Requests\Admin\StaffInviteRequest;
use App\Http\Resources\AuditLogResource;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\Admin\PrivilegedActionGuard;
use App\Services\Admin\StaffService;
use App\Services\Auth\AuthService;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\RateLimiter;
use App\Support\ErrorCode;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Staff and account access. Every write: SUPER_ADMIN route permission + password re-confirmation + reason + audit. */
class AdminStaffController extends ApiController
{
    public function __construct(private readonly StaffService $staff, private readonly PrivilegedActionGuard $guard) {}

    /** PUT /admin/users/{id}/access {platformRole?, status?, reason, currentPassword}: the user's sessions are revoked. */
    public function updateAccess(StaffAccessRequest $request, string $id): JsonResponse
    {
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $request->input('currentPassword'));
        $u = $this->staff->updateAccess($admin, $id, $request->input('platformRole'), $request->input('status'), trim((string) $request->input('reason')));

        return $this->resource($request, UserResource::class, $u, 200, ['message' => 'Access updated. Their sessions were signed out.']);
    }

    /** POST /admin/staff {email, name, role, reason, currentPassword}: grant staff access or invite (set-password e-mail). */
    public function invite(StaffInviteRequest $request): JsonResponse
    {
        $admin = $this->admin($request);
        $this->guard->confirm($admin, $request->input('currentPassword'));
        $r = $this->staff->invite($admin, (string) $request->input('email'), trim((string) $request->input('name')), (string) $request->input('role'), trim((string) $request->input('reason')));

        return $this->resource($request, UserResource::class, $r['user'], $r['created'] ? 201 : 200, [
            'created' => $r['created'],
            'message' => $r['created'] ? 'Invitation sent: they set their own password from the e-mailed link.' : 'Staff role granted. Their sessions were signed out.',
        ]);
    }

    /** GET /admin/staff/permissions: the fixed platform permission matrix (read-only; defined in code). */
    public function permissions(): JsonResponse
    {
        return $this->ok(['roles' => StaffService::STAFF_ROLES, 'permissions' => Permissions::PLATFORM]);
    }

    /** GET /admin/staff/history?page=: privileged staff actions (access changes, invitations, bootstrap, failed re-authentication). */
    public function history(Request $request): JsonResponse
    {
        $page = AuditLog::query()
            ->where(fn ($q) => $q->where('action', 'like', 'admin.user.%')->orWhere('action', 'like', 'admin.staff.%')
                ->orWhere('action', 'like', 'admin.bootstrap%')->orWhere('action', 'like', 'admin.reauth.%'))
            ->with('actor:id,name')->orderByDesc('createdAt')->paginate(50, ['*'], 'page', $this->page($request));

        return $this->paginated($request, $page, AuditLogResource::class);
    }

    /**
     * POST /admin/users/{id}/password-reset (admin:customers:manage): e-mails a reset link to the
     * account's own address. Staff never see a password or token. Staff accounts can only be reset
     * by a super admin; nobody uses this on their own account.
     */
    public function sendPasswordReset(Request $request, string $id, AuthService $auth, AuditLogger $audit, RateLimiter $limiter): JsonResponse
    {
        $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $admin = $this->admin($request);
        $user = User::query()->find($id) ?? throw new AppException(ErrorCode::NOT_FOUND, 'User not found.');
        if ($user->id === $admin->userId) {
            throw new AppException(ErrorCode::FORBIDDEN, 'Use “Forgot password” or your settings for your own account.');
        }
        if ($user->platformRole->value !== 'USER' && $admin->role !== 'SUPER_ADMIN') {
            throw new AppException(ErrorCode::FORBIDDEN, 'Only a super admin can start recovery for a staff account.');
        }
        if ($user->status->value !== 'ACTIVE') {
            throw new AppException(ErrorCode::CONFLICT, 'This account is suspended. Restore it first.');
        }
        if (! $limiter->hit("admin-pwreset:{$user->id}", ['limit' => 3, 'window' => 3600])['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'A reset link was already sent several times this hour.');
        }
        $auth->sendPasswordResetFor($user);
        $audit->log('admin.user.password_reset_sent', $admin->actor(), null, 'user', $user->id, ['reason' => $request->input('reason')], $admin->ip, $admin->userAgent);

        return $this->ok(['message' => 'A password-reset link was e-mailed to the account owner.']);
    }
}
