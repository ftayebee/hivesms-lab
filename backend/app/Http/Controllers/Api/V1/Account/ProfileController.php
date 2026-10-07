<?php

namespace App\Http\Controllers\Api\V1\Account;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\RequestContext;
use App\Http\Requests\Account\OrganizationRequest;
use App\Http\Requests\Account\ProfileRequest;
use App\Http\Requests\Auth\ChangePasswordRequest;
use App\Http\Resources\NotificationResource;
use App\Http\Resources\OrganizationResource;
use App\Http\Resources\UserResource;
use App\Services\Account\AccountService;
use App\Services\Auth\AuthService;
use App\Support\Dhaka;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Profile, password, sessions, notifications, organization settings (port of features/settings). */
class ProfileController extends ApiController
{
    public function __construct(private readonly AccountService $account, private readonly AuthService $auth) {}

    public function show(Request $request): JsonResponse
    {
        return $this->resource($request, UserResource::class, $this->session($request)->user);
    }

    public function update(ProfileRequest $request): JsonResponse
    {
        return $this->resource($request, UserResource::class, $this->account->updateProfile($this->session($request)->user, $request->payload()));
    }

    /** Requires the current password; other sessions are signed out. */
    public function password(ChangePasswordRequest $request): JsonResponse
    {
        $s = $this->session($request);
        $this->auth->changePassword($s->user, $request->input('currentPassword'), $request->input('password'), $s->sessionId, RequestContext::ip($request), RequestContext::userAgent($request));

        return $this->ok(['message' => 'Password updated. Other sessions were signed out.']);
    }

    public function locale(Request $request): JsonResponse
    {
        $data = $request->validate(['locale' => ['required', 'in:en,bn']]);
        $this->account->updateLocale($this->session($request)->user, $data['locale']);

        return $this->ok(['locale' => $data['locale']]);
    }

    public function sessions(Request $request): JsonResponse
    {
        $s = $this->session($request);

        return $this->ok($this->account->listSessions($s->user)->map(fn ($row) => [
            'id' => $row->id, 'ipAddress' => $row->ipAddress, 'userAgent' => $row->userAgent, 'current' => $row->id === $s->sessionId,
            'createdAt' => Dhaka::iso($row->createdAt), 'lastSeenAt' => Dhaka::iso($row->lastSeenAt), 'expiresAt' => Dhaka::iso($row->expiresAt),
        ])->values());
    }

    public function revokeSession(Request $request, string $id): JsonResponse
    {
        $s = $this->session($request);
        $this->account->revokeSession($s->user, $id, $s->sessionId);

        return $this->ok(['revoked' => true]);
    }

    public function notificationPreferences(Request $request): JsonResponse
    {
        return $this->ok($this->account->notificationPreferences($this->session($request)->user));
    }

    public function saveNotificationPreferences(Request $request): JsonResponse
    {
        $data = $request->validate([
            'preferences' => ['required', 'array', 'max:50'],
            'preferences.*.type' => ['required', 'string', 'max:40'],
            'preferences.*.inApp' => ['required', 'boolean'],
            'preferences.*.email' => ['required', 'boolean'],
        ]);
        $user = $this->session($request)->user;
        $this->account->saveNotificationPreferences($user, array_map(fn ($p) => ['type' => $p['type'], 'inApp' => (bool) $p['inApp'], 'email' => (bool) $p['email']], $data['preferences']));

        return $this->ok($this->account->notificationPreferences($user));
    }

    // ─── Organization-scoped (tenant middleware) ───

    public function notifications(Request $request): JsonResponse
    {
        $r = $this->account->notifications($this->tenant($request), $this->page($request));

        return $this->paginated($request, $r['page'], NotificationResource::class, ['unread' => $r['unread']]);
    }

    public function markNotificationsRead(Request $request): JsonResponse
    {
        $data = $request->validate(['ids' => ['nullable', 'array', 'max:100'], 'ids.*' => ['uuid']]);

        return $this->ok(['updated' => $this->account->markNotificationsRead($this->tenant($request), $data['ids'] ?? null)]);
    }

    public function organization(Request $request): JsonResponse
    {
        return $this->resource($request, OrganizationResource::class, $this->account->organization($this->tenant($request)));
    }

    public function updateOrganization(OrganizationRequest $request): JsonResponse
    {
        return $this->resource($request, OrganizationResource::class, $this->account->updateOrganization($this->tenant($request), $request->payload()));
    }

    public function leaveOrganization(Request $request): JsonResponse
    {
        $this->account->leaveOrganization($this->tenant($request));

        return $this->ok(['left' => true]);
    }
}
