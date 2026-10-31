<?php

namespace App\Http\Controllers\Api\V1\Auth;

use App\Http\Controllers\Api\V1\ApiController;
use App\Http\RequestContext;
use App\Http\Resources\UserResource;
use App\Services\Auth\GoogleAuthService;
use App\Services\Auth\SessionService;
use App\Support\Dhaka;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class GoogleAuthController extends ApiController
{
    public function __construct(private readonly GoogleAuthService $google, private readonly SessionService $sessions) {}

    /** GET /auth/providers: public sign-in options, so the panel needs no Google settings of its own. */
    public function providers(): JsonResponse
    {
        $clientId = GoogleAuthService::clientId();

        return $this->ok(['google' => $clientId ? ['clientId' => $clientId, 'redirectUri' => GoogleAuthService::redirectUri()] : null]);
    }

    /** POST /auth/google: exchanges an authorization code for a session, creating the account if new. */
    public function signIn(Request $request): JsonResponse
    {
        $input = $request->validate(['code' => ['required', 'string', 'max:2048'], 'codeVerifier' => ['required', 'string', 'min:43', 'max:128']]);
        $r = $this->google->signIn($input['code'], $input['codeVerifier'], RequestContext::ip($request), RequestContext::userAgent($request));
        ['token' => $token, 'session' => $session] = $this->sessions->create($r['user']->id, $r['organizationId'], false, RequestContext::ip($request), RequestContext::userAgent($request));

        return $this->ok([
            'token' => $token,
            'expiresAt' => Dhaka::iso($session->expiresAt),
            'persistent' => false,
            'user' => (new UserResource($r['user']))->resolve($request),
            'organizationId' => $r['organizationId'],
            'isStaff' => false,
            'created' => $r['created'],
        ], $r['created'] ? 201 : 200);
    }
}
