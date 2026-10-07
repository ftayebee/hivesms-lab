<?php

namespace App\Services\Auth;

use App\Exceptions\AppException;
use App\Mail\EmailTemplates;
use App\Models\User;
use App\Models\VerificationToken;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\Mailer;
use App\Services\Platform\RateLimiter;
use App\Services\Sms\MessageSegmentCalculator;
use App\Services\Sms\SendSmsInput;
use App\Services\Sms\SmsProviderManager;
use App\Support\Crypto;
use App\Support\ErrorCode;
use App\Support\Phone;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Throwable;

/**
 * Authentication business logic (port of src/features/auth/service.ts): registration, sign-in
 * with lockout and rate limits, email verification, password reset/change, phone OTP.
 */
class AuthService
{
    private const MAX_FAILED_LOGINS = 5;

    private const LOCK_MINUTES = 15;

    private const EMAIL_TOKEN_HOURS = 24;

    private const RESET_TOKEN_MINUTES = 60;

    private const OTP_MINUTES = 10;

    private const OTP_MAX_ATTEMPTS = 5;

    private const EMAIL_TAKEN = 'An account with this email already exists. Sign in instead.';

    private const PHONE_TAKEN = 'This mobile number is already registered.';

    public function __construct(
        private readonly PasswordHasher $hasher,
        private readonly SessionService $sessions,
        private readonly OrganizationProvisioner $provisioner,
        private readonly RateLimiter $rateLimiter,
        private readonly AuditLogger $audit,
        private readonly Mailer $mailer,
        private readonly SmsProviderManager $smsProviders,
    ) {}

    private static function appUrl(string $path): string
    {
        return config('smsflow.frontend_url').$path;
    }

    /**
     * @param  array{name: string, company: string, email: string, phone: string, password: string}  $input
     * @return array{userId: string, organizationId: string}
     */
    public function register(array $input, ?string $ip, ?string $userAgent): array
    {
        if (! config('smsflow.features.registration_open')) {
            throw new AppException(ErrorCode::FEATURE_DISABLED, 'Registration is currently closed. Contact sales to open an account.');
        }
        $rl = $this->rateLimiter->hit('register:'.($ip ?? 'unknown'), RateLimiter::rule('register_per_ip'));
        if (! $rl['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many sign-up attempts from this network. Try again later.');
        }

        $existing = User::withTrashed()->where('email', $input['email'])->orWhere('phone', $input['phone'])->first(['email']);
        if ($existing) {
            $emailTaken = $existing->email === $input['email'];
            throw new AppException(ErrorCode::CONFLICT, $emailTaken ? self::EMAIL_TAKEN : self::PHONE_TAKEN, ['field' => $emailTaken ? 'email' : 'phone']);
        }

        $passwordHash = $this->hasher->hash($input['password']);
        try {
            $this->provisioner->ensurePermissionCatalogue();
            // User, organization, roles, owner membership, wallet and audit entry commit together.
            [$user, $org] = DB::transaction(function () use ($input, $passwordHash, $ip, $userAgent) {
                $user = User::query()->forceCreate([
                    'name' => $input['name'],
                    'email' => $input['email'],
                    'phone' => $input['phone'],
                    'passwordHash' => $passwordHash,
                ]);
                $org = $this->provisioner->createOrganizationWithOwner($input['company'], $user->id)['organization'];
                $this->audit->log('auth.register', ['type' => 'USER', 'userId' => $user->id], $org->id, ip: $ip, userAgent: $userAgent);

                return [$user, $org];
            });
        } catch (QueryException $e) {
            // Two concurrent sign-ups can both pass the pre-check; the unique index decides.
            if (($e->errorInfo[1] ?? null) === 1062) {
                $phone = str_contains($e->getMessage(), 'phone');
                throw new AppException(ErrorCode::CONFLICT, $phone ? self::PHONE_TAKEN : self::EMAIL_TAKEN, ['field' => $phone ? 'phone' : 'email']);
            }
            Log::error('registration failed', ['error' => $e->getMessage()]);
            throw new AppException(ErrorCode::INTERNAL_ERROR, "We couldn't create your account right now. Please try again shortly.");
        }

        // The account exists from here on: follow-up emails must not turn the sign-up into an error.
        try {
            $this->issueEmailVerification($user);
        } catch (Throwable $e) {
            Log::error('could not issue email verification after registration', ['user' => Mailer::maskEmail($user->email), 'error' => $e->getMessage()]);
        }
        $this->mailer->send($user->email, EmailTemplates::welcome($user->name));
        Log::info('account registered', ['user' => Mailer::maskEmail($user->email)]);

        return ['userId' => $user->id, 'organizationId' => $org->id];
    }

    public function authenticate(string $identifier, string $password, ?string $ip, ?string $userAgent): User
    {
        $idKey = strtolower(trim($identifier));
        $ipLimit = $this->rateLimiter->hit('login-ip:'.($ip ?? 'unknown'), RateLimiter::rule('login_per_ip'));
        $accountLimit = $this->rateLimiter->hit('login-acct:'.Crypto::sha256($idKey), RateLimiter::rule('login_per_account'));
        if (! $ipLimit['allowed'] || ! $accountLimit['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many sign-in attempts. Wait a few minutes and try again.');
        }

        $phone = Phone::normalize($identifier);
        $user = User::query()->where(fn ($q) => $q->where('email', $idKey)->when($phone, fn ($q2) => $q2->orWhere('phone', $phone)))->first();
        $invalid = new AppException(ErrorCode::UNAUTHORIZED, 'The email/phone or password is incorrect.');

        if (! $user) {
            $this->hasher->burn($password);
            $this->audit->log('auth.login_failed', ['type' => 'SYSTEM'], metadata: ['reason' => 'unknown_account'], ip: $ip, userAgent: $userAgent);
            throw $invalid;
        }
        if ($user->lockedUntil && $user->lockedUntil->isFuture()) {
            $this->hasher->burn($password);
            $minutes = (int) ceil(now()->diffInSeconds($user->lockedUntil) / 60);
            throw new AppException(ErrorCode::RATE_LIMITED, "Too many failed attempts. Try again in {$minutes} minute".($minutes === 1 ? '' : 's').', or reset your password.');
        }

        if (! $this->hasher->verify($user->passwordHash, $password)) {
            $failed = $user->failedLoginCount + 1;
            $lock = $failed >= self::MAX_FAILED_LOGINS;
            $user->forceFill($lock ? ['failedLoginCount' => 0, 'lockedUntil' => now()->addMinutes(self::LOCK_MINUTES)] : ['failedLoginCount' => $failed])->save();
            $this->audit->log($lock ? 'auth.account_locked' : 'auth.login_failed', ['type' => 'USER', 'userId' => $user->id], metadata: ['attempts' => $failed], ip: $ip, userAgent: $userAgent);
            throw $invalid;
        }
        if ($user->status->value === 'SUSPENDED') {
            throw new AppException(ErrorCode::ACCOUNT_SUSPENDED, 'This user account is suspended. Contact support.');
        }

        $user->forceFill(['failedLoginCount' => 0, 'lockedUntil' => null, 'lastLoginAt' => now()])->save();
        $this->audit->log('auth.login', ['type' => 'USER', 'userId' => $user->id], ip: $ip, userAgent: $userAgent);

        return $user;
    }

    // ─── Email verification ───

    public function issueEmailVerification(User $user): void
    {
        if ($user->emailVerifiedAt) {
            return;
        }
        $token = Crypto::randomToken(32);
        VerificationToken::query()->where('userId', $user->id)->where('type', 'EMAIL_VERIFY')->whereNull('consumedAt')->delete();
        VerificationToken::query()->forceCreate([
            'userId' => $user->id,
            'type' => 'EMAIL_VERIFY',
            'tokenHash' => Crypto::sha256($token),
            'target' => $user->email,
            'expiresAt' => now()->addHours(self::EMAIL_TOKEN_HOURS),
        ]);
        $this->mailer->send($user->email, EmailTemplates::verifyEmail($user->name, self::appUrl('/verify-email?token='.$token)));
    }

    public function verifyEmailToken(string $token): string
    {
        $row = VerificationToken::query()->with('user')->where('tokenHash', Crypto::sha256($token))->first();
        if (! $row || $row->type->value !== 'EMAIL_VERIFY' || $row->consumedAt || $row->expiresAt->isPast() || ! $row->user || $row->target !== $row->user->email) {
            throw new AppException(ErrorCode::INVALID_REQUEST, 'This verification link is invalid or has expired. Request a new one from your dashboard.');
        }
        DB::transaction(function () use ($row) {
            $row->forceFill(['consumedAt' => now()])->save();
            $row->user->forceFill(['emailVerifiedAt' => now()])->save();
        });
        $this->audit->log('auth.email_verified', ['type' => 'USER', 'userId' => $row->userId]);

        return $row->userId;
    }

    // ─── Password reset / change ───

    public function requestPasswordReset(string $email, ?string $ip): void
    {
        $rl = $this->rateLimiter->hit('pwreset:'.($ip ?? 'unknown'), RateLimiter::rule('password_reset_per_ip'));
        if (! $rl['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many reset requests. Try again later.');
        }
        $user = User::query()->where('email', $email)->where('status', 'ACTIVE')->first();
        // Same behaviour whether or not the account exists (no account enumeration).
        if (! $user) {
            return;
        }
        $token = Crypto::randomToken(32);
        VerificationToken::query()->where('userId', $user->id)->where('type', 'PASSWORD_RESET')->whereNull('consumedAt')->delete();
        VerificationToken::query()->forceCreate([
            'userId' => $user->id,
            'type' => 'PASSWORD_RESET',
            'tokenHash' => Crypto::sha256($token),
            'target' => $user->email,
            'expiresAt' => now()->addMinutes(self::RESET_TOKEN_MINUTES),
        ]);
        $this->mailer->send($user->email, EmailTemplates::passwordReset($user->name, self::appUrl('/reset-password?token='.$token)));
        $this->audit->log('auth.password_reset_requested', ['type' => 'USER', 'userId' => $user->id], ip: $ip);
    }

    public function resetPassword(string $token, string $password, ?string $ip, ?string $userAgent): void
    {
        $row = VerificationToken::query()->with('user')->where('tokenHash', Crypto::sha256($token))->first();
        if (! $row || $row->type->value !== 'PASSWORD_RESET' || $row->consumedAt || $row->expiresAt->isPast() || ! $row->user) {
            throw new AppException(ErrorCode::INVALID_REQUEST, 'This reset link is invalid or has expired. Request a new one.');
        }
        $hash = $this->hasher->hash($password);
        DB::transaction(function () use ($row, $hash) {
            $claimed = VerificationToken::query()->whereKey($row->id)->whereNull('consumedAt')->update(['consumedAt' => now()->format('Y-m-d H:i:s.v')]);
            if (! $claimed) {
                throw new AppException(ErrorCode::INVALID_REQUEST, 'This reset link is invalid or has expired. Request a new one.');
            }
            $row->user->forceFill([
                'passwordHash' => $hash,
                'passwordChangedAt' => now(),
                'failedLoginCount' => 0,
                'lockedUntil' => null,
                'emailVerifiedAt' => $row->user->emailVerifiedAt ?? now(),
            ])->save();
        });
        $this->sessions->revokeAllForUser($row->userId);
        $this->audit->log('auth.password_reset', ['type' => 'USER', 'userId' => $row->userId], ip: $ip, userAgent: $userAgent);
        $this->mailer->send($row->user->email, EmailTemplates::passwordChanged($row->user->name));
    }

    public function changePassword(User $user, string $current, string $new, string $keepSessionId, ?string $ip, ?string $userAgent): void
    {
        if (! $this->hasher->verify($user->passwordHash, $current)) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Your current password is incorrect.', ['field' => 'currentPassword']);
        }
        $user->forceFill(['passwordHash' => $this->hasher->hash($new)])->save();
        // Keep the current session alive; revoke every other session.
        $this->sessions->revokeAllForUser($user->id, $keepSessionId);
        $this->audit->log('auth.password_changed', ['type' => 'USER', 'userId' => $user->id], ip: $ip, userAgent: $userAgent);
        $this->mailer->send($user->email, EmailTemplates::passwordChanged($user->name));
    }

    // ─── Phone verification (OTP) ───

    private function otpHash(string $tokenId, string $code): string
    {
        return Crypto::hmacSha256((string) config('smsflow.auth_secret'), "{$tokenId}:{$code}");
    }

    public function sendPhoneOtp(User $user): void
    {
        if (! config('smsflow.features.phone_verification')) {
            throw new AppException(ErrorCode::FEATURE_DISABLED, 'Phone verification is not enabled.');
        }
        if (! $user->phone) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'Add a mobile number to your profile first.');
        }
        $rl = $this->rateLimiter->hit('otp:'.$user->id, RateLimiter::rule('otp_per_user'));
        if (! $rl['allowed']) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many codes requested. Try again in an hour.');
        }
        $code = Crypto::randomNumericCode(6);
        $id = (string) Str::uuid();
        VerificationToken::query()->where('userId', $user->id)->where('type', 'PHONE_OTP')->whereNull('consumedAt')->delete();
        VerificationToken::query()->forceCreate([
            'id' => $id,
            'userId' => $user->id,
            'type' => 'PHONE_OTP',
            'tokenHash' => $this->otpHash($id, $code),
            'target' => $user->phone,
            'expiresAt' => now()->addMinutes(self::OTP_MINUTES),
        ]);

        // Platform system message: sent directly through the provider, not billed to the customer.
        $provider = $this->smsProviders->sendingProvider();
        $message = "Your verification code is {$code}. It expires in ".self::OTP_MINUTES.' minutes. Do not share it.';
        $result = $provider->send(new SendSmsInput(
            reference: "otp:{$id}",
            to: $user->phone,
            message: $message,
            senderId: (string) config('smsflow.sms.default_sender_id'),
            senderType: 'NON_MASKING',
            smsType: 'TRANSACTIONAL',
            encoding: MessageSegmentCalculator::detectEncoding($message)['encoding'],
        ));
        if (! $result->ok) {
            Log::error('OTP send failed', ['to' => Phone::mask($user->phone), 'code' => $result->errorCode]);
            throw new AppException(ErrorCode::PROVIDER_ERROR, 'We could not send the code right now. Try again in a minute.');
        }
        if ($provider->key() === 'mock' && ! app()->isProduction()) {
            Log::debug('DEV OTP', ['phone' => $user->phone, 'code' => $code]);
        }
    }

    public function verifyPhoneOtp(User $user, string $code): void
    {
        $row = VerificationToken::query()->where('userId', $user->id)->where('type', 'PHONE_OTP')->whereNull('consumedAt')->latest('createdAt')->first();
        if (! $row || $row->expiresAt->isPast()) {
            throw new AppException(ErrorCode::INVALID_REQUEST, 'The code has expired. Request a new one.');
        }
        if ($row->attempts >= self::OTP_MAX_ATTEMPTS) {
            throw new AppException(ErrorCode::RATE_LIMITED, 'Too many incorrect attempts. Request a new code.');
        }
        if (! Crypto::safeEqual($row->tokenHash, $this->otpHash($row->id, $code)) || $row->target !== $user->phone) {
            VerificationToken::query()->whereKey($row->id)->increment('attempts');
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'That code is incorrect.', ['field' => 'code']);
        }
        DB::transaction(function () use ($row, $user) {
            $row->forceFill(['consumedAt' => now()])->save();
            $user->forceFill(['phoneVerifiedAt' => now()])->save();
        });
        $this->audit->log('auth.phone_verified', ['type' => 'USER', 'userId' => $user->id]);
    }

    /** Onboarding: a signed-in user without an organization creates one. */
    public function createOrganization(User $user, string $company): string
    {
        $this->provisioner->ensurePermissionCatalogue();
        $org = DB::transaction(fn () => $this->provisioner->createOrganizationWithOwner($company, $user->id)['organization']);
        $this->audit->log('organization.create', ['type' => 'USER', 'userId' => $user->id], $org->id);

        return $org->id;
    }
}
