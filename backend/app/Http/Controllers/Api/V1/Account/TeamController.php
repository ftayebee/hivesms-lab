<?php

namespace App\Http\Controllers\Api\V1\Account;

use App\Auth\Permissions;
use App\Http\Controllers\Api\V1\ApiController;
use App\Http\Requests\Account\TeamInviteRequest;
use App\Http\Resources\InvitationResource;
use App\Http\Resources\TeamMemberResource;
use App\Services\Team\TeamService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Team members, invitations and per-organization role permissions. */
class TeamController extends ApiController
{
    public function __construct(private readonly TeamService $team) {}

    public function index(Request $request): JsonResponse
    {
        $r = $this->team->list($this->tenant($request));

        return $this->ok([
            'members' => TeamMemberResource::collection($r['members'])->resolve($request),
            'invitations' => InvitationResource::collection($r['invitations'])->resolve($request),
            'roles' => $r['roles'],
            'permissions' => array_map(fn ($p) => ['group' => $p[0], 'description' => $p[1]], Permissions::ORG),
        ]);
    }

    public function invite(TeamInviteRequest $request): JsonResponse
    {
        $inv = $this->team->invite($this->tenant($request), $request->input('email'), $request->input('role'));

        return $this->resource($request, InvitationResource::class, $inv, 201, ['message' => "Invitation sent to {$inv->email}."]);
    }

    public function revokeInvitation(Request $request, string $id): JsonResponse
    {
        $this->team->revokeInvitation($this->tenant($request), $id);

        return $this->ok(['revoked' => true]);
    }

    public function changeRole(Request $request, string $memberId): JsonResponse
    {
        $data = $request->validate(['role' => ['required', 'in:OWNER,ADMIN,MANAGER,DEVELOPER,VIEWER']]);
        $this->team->changeRole($this->tenant($request), $memberId, $data['role']);

        return $this->ok(['message' => 'Role updated.']);
    }

    public function setStatus(Request $request, string $memberId): JsonResponse
    {
        $data = $request->validate(['action' => ['required', 'in:remove,disable,enable']]);
        $this->team->setStatus($this->tenant($request), $memberId, $data['action']);

        return $this->ok(['message' => match ($data['action']) {
            'remove' => 'Member removed.', 'disable' => 'Member disabled.', default => 'Member re-enabled.'
        }]);
    }

    public function updateRolePermissions(Request $request, string $role): JsonResponse
    {
        $request->merge(['role' => $role]);
        $data = $request->validate(['role' => ['required', 'in:OWNER,ADMIN,MANAGER,DEVELOPER,VIEWER'], 'permissions' => ['present', 'array', 'max:100'], 'permissions.*' => ['string', 'max:60']]);
        $this->team->updateRolePermissions($this->tenant($request), $data['role'], $data['permissions']);

        return $this->ok(['message' => "Permissions saved. They apply on the member's next request."]);
    }
}
