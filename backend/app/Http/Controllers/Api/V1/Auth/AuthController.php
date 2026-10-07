<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Auth\Permissions;
use App\Exceptions\AppException;
use App\Http\Controllers\Api\V1\ApiController;
use App\Http\RequestContext;
use App\Http\Requests\Auth\ForgotPasswordRequest;
use App\Http\Requests\Auth\InviteSignupRequest;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Requests\Auth\ResetPasswordRequest;
use App\Http\Resources\UserResource;
use App\Models\Notification;
use App\Models\User;
use App\Models\Wallet;
use App\Services\Account\AccountService;
use App\Services\Auth\AuthService;
use App\Services\Auth\SessionService;
use App\Services\Platform\AuditLogger;
use App\Services\Team\TeamService;
use App\Support\Dhaka;
use App\Support\ErrorCode;
use App\Support\Money;
use App\Support\Phone;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Authentication API. Sessions are the existing `sessions` rows: login/register return the opaque
 * token once; the Next.js server stores it in its httpOnly cookie and sends it back as
 * `Authorization: Bearer <token>`. The token is never stored server-side in clear (sha256 only).
 */
class AuthController extends ApiController
{
    public function __construct(
        private readonly AuthService $auth,
        private readonly SessionService $sessions,
        private readonly AccountService $account,
        private readonly TeamService $team,
        private readonly AuditLogger $audit,
    ) {}

    private function issue(Request $request, User $user, ?string $organizationId, bool $remember, int $status = 200, array $extra = []): JsonResponse
    {
        ['token' => $token, 'session' => $session] = $this->sessions->create($user->id, $organizationId, $remember, RequestContext::ip($request), RequestContext::userAgent($request));

        return $this->ok([
            'token' => $token,
            'expiresAt' => Dhaka::iso($session->expiresAt),
            'persistent' => $remember,
            'user' => (new UserResource($user))->resolve($request),
            'organizationId' => $organizationId,
            'isStaff' => $user->platformRole->value !== 'USER',
        ] + $extra, $status);
    }

    /** POST /auth/register: user + organization + wallet, verification email, signed in. */
    public function register(RegisterRequest $request): JsonResponse
    {
        $r = $this->auth->register($request->payload(), RequestContext::ip($request), RequestContext::userAgent($request));
        $user = User::query()->findOrFail($r['userId']);

        return $this->issue($request, $user, $r['organizationId'], false, 201, ['emailVerificationSent' => true]);
    }

    /** POST /auth/login: email or BD mobile + password; lockout after 5 failures. */
    public function login(LoginRequest $request): JsonResponse
    {
        $user = $this->auth->authenticate($request->input('identifier'), $request->input('password'), RequestContext::ip($request), RequestContext::userAgent($request));

        return $this->issue($request, $user, $this->sessions->defaultOrganizationFor($user->id), (bool) $request->boolean('remember'));
    }

    /** POST /auth/logout: revokes the current session. */
    public function logout(Request $request): JsonResponse
    {
        $s = $this->session($request);
        $this->audit->log('auth.logout', ['type' => 'USER', 'userId' => $s->user->id]);
        $this->sessions->revoke($s->sessionId);

        return $this->ok(['signedOut' => true]);
    }

    /** GET /auth/me: user, active organization with role and permissions, other organizations. */
    public function me(Request $request): JsonResponse
    {
        $s = $this->session($request);
        $ctx = $this->sessions->tenantFor($s, RequestContext::ip($request), RequestContext::userAgent($request));
        $org = $ctx ? $this->account->organization($ctx) : null;

        // Everything the dashboard shell renders (port of app/dashboard/layout.tsx data loading).
        return $this->ok([
            'user' => (new UserResource($s->user))->resolve($request),
            'session' => ['id' => $s->sessionId, 'expiresAt' => Dhaka::iso($s->expiresAt)],
            'organization' => $org ? [
                'id' => $org->id, 'name' => $org->name, 'slug' => $org->slug, 'status' => $org->status->value,
                'suspendedReason' => $org->suspendedReason,
                'role' => $ctx->roleKey, 'permissions' => $ctx->permissions,
                'plan' => $org->pricingPlan ? ['id' => $org->pricingPlan->id, 'name' => $org->pricingPlan->name] : null,
                'balance' => $ctx->can('billing:read') ? Money::round((string) (Wallet::query()->where('organizationId', $org->id)->value('balance') ?? '0'), 2) : null,
                'unreadNotifications' => Notification::query()->where('userId', $s->user->id)->where('organizationId', $org->id)->whereNull('readAt')->count(),
            ] : null,
            'organizations' => $this->account->organizations($s->user),
            'platformPermissions' => Permissions::platformPermissionsFor($s->user->platformRole->value),
            'features' => ['phoneVerification' => (bool) config('smsflow.features.phone_verification')],
        ]);
    }

    public function verifyEmail(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'min:20', 'max:200']]);
        $this->auth->verifyEmailToken($data['token']);

        return $this->ok(['emailVerified' => true]);
    }

    public function resendVerification(Request $request): JsonResponse
    {
        $user = $this->session($request)->user;
        $this->auth->issueEmailVerification($user);

        return $this->ok(['message' => $user->emailVerifiedAt ? 'Your email address is already verified.' : "We sent a new verification link to {$user->email}."]);
    }

    /** Always 202: no account enumeration. */
    public function forgotPassword(ForgotPasswordRequest $request): JsonResponse
    {
        $this->auth->requestPasswordReset($request->input('email'), RequestContext::ip($request));

        return $this->ok(['message' => 'If an account exists for that email, a reset link is on its way. It expires in 1 hour.'], 202);
    }

    /** Consumes the reset token; every session of the user is revoked. */
    public function resetPassword(ResetPasswordRequest $request): JsonResponse
    {
        $this->auth->resetPassword($request->input('token'), $request->input('password'), RequestContext::ip($request), RequestContext::userAgent($request));

        return $this->ok(['passwordReset' => true]);
    }

    public function sendOtp(Request $request): JsonResponse
    {
        $this->auth->sendPhoneOtp($this->session($request)->user);

        return $this->ok(['message' => 'We sent a 6-digit code to your mobile number.']);
    }

    public function verifyOtp(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'regex:/^\d{6}$/']], ['code.*' => 'Enter the 6-digit code.']);
        $this->auth->verifyPhoneOtp($this->session($request)->user, $data['code']);

        return $this->ok(['phoneVerified' => true]);
    }

    /** POST /auth/switch-organization: the user must be an active member. */
    public function switchOrganization(Request $request): JsonResponse
    {
        $data = $request->validate(['organizationId' => ['required', 'uuid']]);
        $s = $this->session($request);
        if (! $this->sessions->buildTenantContext($s->user->id, $data['organizationId'])) {
            throw new AppException(ErrorCode::FORBIDDEN, 'You are not a member of that organization.');
        }
        $this->sessions->setActiveOrganization($s->sessionId, $data['organizationId']);

        return $this->ok(['organizationId' => $data['organizationId']]);
    }

    /** POST /auth/organizations: onboarding for a signed-in user without an organization. */
    public function createOrganization(Request $request): JsonResponse
    {
        $data = $request->validate(['company' => ['required', 'string', 'min:2', 'max:120']], ['company.*' => 'Enter your organization name.']);
        $s = $this->session($request);
        $orgId = $this->auth->createOrganization($s->user, trim($data['company']));
        $this->sessions->setActiveOrganization($s->sessionId, $orgId);

        return $this->ok(['organizationId' => $orgId], 201);
    }

    /** GET /auth/invitations/{token}: public invitation details for the accept page. */
    public function invitation(string $token): JsonResponse
    {
        $inv = $this->team->findInvitation($token) ?? throw new AppException(ErrorCode::NOT_FOUND, 'This invitation is invalid or has expired.');

        return $this->ok([
            'email' => $inv->email,
            'organization' => ['id' => $inv->organization->id, 'name' => $inv->organization->name],
            'role' => $inv->role->name,
            'expiresAt' => Dhaka::iso($inv->expiresAt),
            'accountExists' => User::withTrashed()->where('email', $inv->email)->exists(),
        ]);
    }

    /** POST /auth/invitations/accept: the signed-in user joins; the organization becomes active. */
    public function acceptInvitation(Request $request): JsonResponse
    {
        $data = $request->validate(['token' => ['required', 'string', 'min:20', 'max:200']]);
        $s = $this->session($request);
        $orgId = $this->team->accept($data['token'], $s->user);
        $this->sessions->setActiveOrganization($s->sessionId, $orgId);

        return $this->ok(['organizationId' => $orgId]);
    }

    /** POST /auth/invitations/signup: new account from an invitation, joined and signed in. */
    public function invitationSignup(InviteSignupRequest $request): JsonResponse
    {
        $phone = $request->filled('phone') ? Phone::normalize($request->input('phone')) : null;
        $user = $this->team->createUserForInvitation($request->input('token'), trim($request->input('name')), $phone, $request->input('password'));
        $orgId = $this->team->accept($request->input('token'), $user);

        return $this->issue($request, $user->refresh(), $orgId, (bool) $request->boolean('remember'), 201);
    }
}
