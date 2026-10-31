<?php

namespace App\Services\Auth;

use App\Exceptions\AppException;
use App\Mail\EmailTemplates;
use App\Models\User;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\Mailer;
use App\Services\Platform\RateLimiter;
use App\Support\Crypto;
use App\Support\ErrorCode;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Sign in and sign up with Google (OpenID Connect authorization code flow with PKCE). The Next.js
 * server handles the browser redirects and the state check; the code is exchanged here so the client
 * secret stays in this API. Accounts are matched on Google's verified email, so no schema change.
 */
class GoogleAuthService
{
    private const TOKEN_URL = 'https://oauth2.googleapis.com/token';

    private const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly OrganizationProvisioner $provisioner,
        private readonly SessionService $sessions,
        private readonly RateLimiter $rateLimiter,
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer,
    ) {}

    public static function clientId(): ?string
    {
        $id = (string) config('services.google.client_id');

        return $id !== '' && (string) config('services.google.client_secret') !== '' ? $id : null;
    }

    public static function redirectUri(): string
    {
        return config('smsflow.frontend_url').'/api/auth/google/callback';
    }

    /** @return array{user: User, organizationId: ?string, created: bool} */
    public function signIn(string $code, string $codeVerifier, ?string $ip, ?string $userAgent): array
    {
        if (self::clientId() === null) {
            throw new AppException(ErrorCode::FEATURE_DISABLED, 'Google sign-in is not available.');
        }
        $limit = $this->rateLimiter->hit('login-ip:'.($ip ?? 'unknown'), RateLimiter::rule('login_per_ip'));
        if (! $limit['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many sign-in attempts. Wait a few minutes and try again.');
        }

        $profile = $this->exchange($code, $codeVerifier);
        $email = strtolower(trim($profile['email']));
        $user = User::withTrashed()->where('email', $email)->first();
        if (! $user) {
            return $this->createAccount($email, $profile['name'], $ip, $userAgent);
        }

        if ($user->trashed() || $user->status->value === 'SUSPENDED') {
            throw new AppException(ErrorCode::ACCOUNT_SUSPENDED, 'This account is not available. Contact support.');
        }
        // Staff accounts reach customer data and money, so they keep their password and its lockout.
        if ($user->platformRole->value !== 'USER') {
            throw new AppException(ErrorCode::FORBIDDEN, 'Staff accounts sign in with their password.');
        }

        $changes = ['failedLoginCount' => 0, 'lockedUntil' => null, 'lastLoginAt' => now()];
        if (! $user->emailVerifiedAt) {
            // Someone could have registered this address without owning it, then waited for the real
            // owner to arrive. Google proves ownership, so end any access the earlier sign-up holds.
            $changes += ['emailVerifiedAt' => now(), 'passwordHash' => $this->hasher->hash(Crypto::randomToken(32)), 'passwordChangedAt' => now()];
            $this->sessions->revokeAllForUser($user->id);
        }
        $user->forceFill($changes)->save();
        $this->audit->log('auth.login', ['type' => 'USER', 'userId' => $user->id], metadata: ['method' => 'google'], ip: $ip, userAgent: $userAgent);

        return ['user' => $user, 'organizationId' => $this->sessions->defaultOrganizationFor($user->id), 'created' => false];
    }

    /** @return array{email: string, name: string} */
    private function exchange(string $code, string $codeVerifier): array
    {
        $failed = new AppException(ErrorCode::UNAUTHORIZED, 'Google could not confirm your account. Please try again.');
        try {
            $res = Http::asForm()->acceptJson()->connectTimeout(5)->timeout(10)->post(self::TOKEN_URL, [
                'grant_type' => 'authorization_code',
                'code' => $code,
                'code_verifier' => $codeVerifier,
                'client_id' => config('services.google.client_id'),
                'client_secret' => config('services.google.client_secret'),
                'redirect_uri' => self::redirectUri(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('google token request failed', ['error' => $e->getMessage()]);
            throw new AppException(ErrorCode::INTERNAL_ERROR, 'Could not reach Google. Please try again.');
        }
        if (! $res->successful()) {
            Log::warning('google rejected the sign-in code', ['status' => $res->status(), 'error' => $res->json('error')]);
            throw $failed;
        }

        // Received directly from Google over TLS, so OpenID Connect allows skipping the signature check.
        $parts = explode('.', (string) $res->json('id_token'));
        $claims = count($parts) === 3 ? json_decode((string) base64_decode(strtr($parts[1], '-_', '+/')), true) : null;
        $valid = is_array($claims)
            && in_array($claims['iss'] ?? null, self::ISSUERS, true)
            && ($claims['aud'] ?? null) === config('services.google.client_id')
            && (int) ($claims['exp'] ?? 0) > now()->getTimestamp()
            && ! empty($claims['sub'])
            && filter_var($claims['email'] ?? null, FILTER_VALIDATE_EMAIL)
            && ($claims['email_verified'] ?? false) === true;
        if (! $valid) {
            Log::warning('google id token failed validation');
            throw $failed;
        }

        return ['email' => $claims['email'], 'name' => trim((string) ($claims['name'] ?? ''))];
    }

    /** @return array{user: User, organizationId: string, created: bool} */
    private function createAccount(string $email, string $name, ?string $ip, ?string $userAgent): array
    {
        if (! config('smsflow.features.registration_open')) {
            throw new AppException(ErrorCode::FEATURE_DISABLED, 'Registration is currently closed. Contact sales to open an account.');
        }
        $limit = $this->rateLimiter->hit('register:'.($ip ?? 'unknown'), RateLimiter::rule('register_per_ip'));
        if (! $limit['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many sign-up attempts from this network. Try again later.');
        }

        $displayName = mb_substr($name !== '' ? $name : strstr($email, '@', true), 0, 100);
        $passwordHash = $this->hasher->hash(Crypto::randomToken(32));
        try {
            $this->provisioner->ensurePermissionCatalogue();
            [$user, $org] = DB::transaction(function () use ($email, $displayName, $passwordHash, $ip, $userAgent) {
                $user = User::query()->forceCreate(['name' => $displayName, 'email' => $email, 'passwordHash' => $passwordHash, 'emailVerifiedAt' => now(), 'lastLoginAt' => now()]);
                $org = $this->provisioner->createOrganizationWithOwner($displayName, $user->id)['organization'];
                $this->audit->log('auth.register', ['type' => 'USER', 'userId' => $user->id], $org->id, metadata: ['method' => 'google'], ip: $ip, userAgent: $userAgent);

                return [$user, $org];
            });
        } catch (QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new AppException(ErrorCode::CONFLICT, 'This email was just registered. Please try signing in again.');
            }
            Log::error('google registration failed', ['error' => $e->getMessage()]);
            throw new AppException(ErrorCode::INTERNAL_ERROR, "We couldn't create your account right now. Please try again shortly.");
        }
        $this->mailer->send($user->email, EmailTemplates::welcome($user->name));

        return ['user' => $user, 'organizationId' => $org->id, 'created' => true];
    }
}
