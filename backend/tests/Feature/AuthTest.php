<?php

namespace Tests\Feature;

use App\Models\Session;
use App\Models\User;
use App\Models\VerificationToken;
use App\Services\Auth\SessionService;
use App\Support\Crypto;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class AuthTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private function registerPayload(array $over = []): array
    {
        return $over + [
            'name' => 'Rahim Uddin', 'company' => 'Rahim Traders', 'email' => 'Rahim@Example.com', 'phone' => '01712345678',
            'password' => 'StrongPass2026', 'confirmPassword' => 'StrongPass2026', 'acceptTerms' => true,
        ];
    }

    public function test_register_creates_user_organization_roles_wallet_and_session(): void
    {
        Mail::fake();
        $this->seedPlan();
        $res = $this->postJson('/api/v1/auth/register', $this->registerPayload());

        $res->assertCreated()->assertJsonPath('success', true)->assertJsonPath('data.user.email', 'rahim@example.com')->assertJsonPath('data.user.phone', '+8801712345678');
        $this->assertArrayNotHasKey('passwordHash', $res->json('data.user'));
        $user = User::query()->where('email', 'rahim@example.com')->firstOrFail();
        $this->assertStringStartsWith('$argon2id$', $user->passwordHash);
        $orgId = $res->json('data.organizationId');
        $this->assertDatabaseHas('wallets', ['organizationId' => $orgId]);
        $this->assertDatabaseCount('roles', 5);
        $this->assertDatabaseHas('verification_tokens', ['userId' => $user->id, 'type' => 'EMAIL_VERIFY']);
        // The returned token is a valid session in the Node format (sha256 stored).
        $this->assertDatabaseHas('sessions', ['tokenHash' => Crypto::sha256($res->json('data.token'))]);
        $this->getJson('/api/v1/auth/me', ['Authorization' => 'Bearer '.$res->json('data.token')])
            ->assertOk()->assertJsonPath('data.organization.role', 'OWNER')->assertJsonPath('data.user.emailVerifiedAt', null);
    }

    public function test_register_validation_and_duplicate_email(): void
    {
        $this->seedPlan();
        $this->postJson('/api/v1/auth/register', $this->registerPayload(['password' => 'password123', 'confirmPassword' => 'nope', 'phone' => '0123']))
            ->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_ERROR')
            ->assertJsonFragment(['path' => 'phone'])->assertJsonFragment(['path' => 'confirmPassword'])->assertJsonFragment(['message' => 'This password is too common. Choose another.']);

        User::factory()->create(['email' => 'rahim@example.com']);
        $this->postJson('/api/v1/auth/register', $this->registerPayload())->assertStatus(409)->assertJsonPath('error.code', 'CONFLICT')->assertJsonPath('error.details.field', 'email');
    }

    public function test_login_with_email_or_phone_and_existing_argon_hash(): void
    {
        $user = User::factory()->create(['email' => 'login@example.com', 'phone' => '+8801812345678']);
        $this->postJson('/api/v1/auth/login', ['identifier' => 'LOGIN@example.com', 'password' => UserFactory::PASSWORD])->assertOk()->assertJsonStructure(['data' => ['token', 'expiresAt', 'user']]);
        $this->postJson('/api/v1/auth/login', ['identifier' => '01812345678', 'password' => UserFactory::PASSWORD, 'remember' => true])->assertOk()->assertJsonPath('data.persistent', true);
        $this->assertSame(2, Session::query()->where('userId', $user->id)->count());
    }

    public function test_invalid_password_unknown_account_and_lockout(): void
    {
        User::factory()->create(['email' => 'lock@example.com']);
        $this->postJson('/api/v1/auth/login', ['identifier' => 'nobody@example.com', 'password' => 'x'])->assertStatus(401)->assertJsonPath('error.code', 'UNAUTHORIZED');
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/auth/login', ['identifier' => 'lock@example.com', 'password' => 'wrong-password'])->assertStatus(401);
        }
        // Locked now, even with the right password.
        $this->postJson('/api/v1/auth/login', ['identifier' => 'lock@example.com', 'password' => UserFactory::PASSWORD])->assertStatus(429)->assertJsonPath('error.code', 'RATE_LIMITED');
        $this->assertNotNull(User::query()->where('email', 'lock@example.com')->value('lockedUntil'));
    }

    public function test_suspended_user_cannot_log_in_and_existing_sessions_stop_working(): void
    {
        $t = $this->tenant();
        $t['user']->forceFill(['status' => 'SUSPENDED'])->save();
        $this->postJson('/api/v1/auth/login', ['identifier' => $t['user']->email, 'password' => UserFactory::PASSWORD])->assertStatus(403)->assertJsonPath('error.code', 'ACCOUNT_SUSPENDED');
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertStatus(401);
    }

    public function test_login_is_rate_limited_per_account(): void
    {
        User::factory()->create(['email' => 'rl@example.com']);
        config(['smsflow.rate_limits.login_per_account' => ['limit' => 2, 'window' => 600]]);
        $this->postJson('/api/v1/auth/login', ['identifier' => 'rl@example.com', 'password' => UserFactory::PASSWORD])->assertOk();
        $this->postJson('/api/v1/auth/login', ['identifier' => 'rl@example.com', 'password' => UserFactory::PASSWORD])->assertOk();
        $this->postJson('/api/v1/auth/login', ['identifier' => 'rl@example.com', 'password' => UserFactory::PASSWORD])->assertStatus(429);
    }

    public function test_me_requires_a_valid_session_and_logout_revokes_it(): void
    {
        $this->getJson('/api/v1/auth/me')->assertStatus(401)->assertJsonPath('error.code', 'UNAUTHORIZED');
        $this->getJson('/api/v1/auth/me', ['Authorization' => 'Bearer not-a-token'])->assertStatus(401);
        $t = $this->tenant();
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertOk()->assertJsonPath('data.user.id', $t['user']->id)->assertJsonPath('data.organization.id', $t['org']->id);
        $this->postJson('/api/v1/auth/logout', [], $t['headers'])->assertOk();
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertStatus(401);
    }

    public function test_session_created_by_the_node_app_is_accepted(): void
    {
        $t = $this->tenant();
        // Exactly what src/lib/auth/session-store.ts writes: random base64url token, sha256 stored.
        $token = Crypto::randomToken(32);
        Session::query()->forceCreate(['tokenHash' => hash('sha256', $token), 'userId' => $t['user']->id, 'activeOrganizationId' => $t['org']->id, 'expiresAt' => now()->addDay(), 'lastSeenAt' => now()]);
        $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$token}"])->assertOk();
    }

    public function test_expired_session_is_rejected_and_deleted(): void
    {
        $t = $this->tenant();
        Session::query()->where('tokenHash', Crypto::sha256($t['token']))->update(['expiresAt' => now()->subMinute()]);
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertStatus(401);
        $this->assertDatabaseMissing('sessions', ['tokenHash' => Crypto::sha256($t['token'])]);
    }

    public function test_forgot_password_never_reveals_accounts_and_reset_revokes_sessions(): void
    {
        Mail::fake();
        $t = $this->tenant();
        $this->postJson('/api/v1/auth/password/forgot', ['email' => 'ghost@example.com'])->assertStatus(202);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $t['user']->email])->assertStatus(202);

        $token = Crypto::randomToken(32);
        VerificationToken::query()->where('userId', $t['user']->id)->where('type', 'PASSWORD_RESET')->update(['tokenHash' => Crypto::sha256($token)]);
        $this->postJson('/api/v1/auth/password/reset', ['token' => $token, 'password' => 'NewSecret2026x', 'confirmPassword' => 'NewSecret2026x'])->assertOk();
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertStatus(401);
        $this->postJson('/api/v1/auth/login', ['identifier' => $t['user']->email, 'password' => 'NewSecret2026x'])->assertOk();
        // One-time use.
        $this->postJson('/api/v1/auth/reset-password', ['token' => $token, 'password' => 'Another2026xx', 'confirmPassword' => 'Another2026xx'])->assertStatus(400)->assertJsonPath('error.code', 'INVALID_REQUEST');
    }

    public function test_email_verification_token(): void
    {
        $user = User::factory()->unverified()->create();
        $token = Crypto::randomToken(32);
        VerificationToken::query()->forceCreate(['userId' => $user->id, 'type' => 'EMAIL_VERIFY', 'tokenHash' => Crypto::sha256($token), 'target' => $user->email, 'expiresAt' => now()->addDay()]);
        $this->postJson('/api/v1/auth/verify-email', ['token' => $token])->assertOk()->assertJsonPath('data.emailVerified', true);
        $this->assertNotNull($user->refresh()->emailVerifiedAt);
        $this->postJson('/api/v1/auth/email/verify', ['token' => $token])->assertStatus(400);
    }

    public function test_change_password_requires_current_password_and_signs_out_other_sessions(): void
    {
        Mail::fake();
        $t = $this->tenant();
        $other = app(SessionService::class)->create($t['user']->id, $t['org']->id, false, null, null)['token'];
        $this->putJson('/api/v1/profile/password', ['currentPassword' => 'wrong', 'password' => 'NewSecret2026x', 'confirmPassword' => 'NewSecret2026x'], $t['headers'])
            ->assertStatus(422)->assertJsonPath('error.details.field', 'currentPassword');
        $this->putJson('/api/v1/profile/password', ['currentPassword' => UserFactory::PASSWORD, 'password' => 'NewSecret2026x', 'confirmPassword' => 'NewSecret2026x'], $t['headers'])->assertOk();
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertOk();
        $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$other}"])->assertStatus(401);
    }

    public function test_api_key_cannot_be_used_as_a_session_and_session_cannot_call_the_sms_api(): void
    {
        $t = $this->tenant();
        $key = $this->apiKey($t['org']);
        $this->getJson('/api/v1/auth/me', $key['headers'])->assertStatus(401);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hi'], $t['headers'])->assertStatus(401)->assertJsonPath('error.code', 'INVALID_API_KEY');
    }

    public function test_switch_organization_requires_membership(): void
    {
        $a = $this->tenant();
        $b = $this->tenant();
        $this->postJson('/api/v1/auth/switch-organization', ['organizationId' => $b['org']->id], $a['headers'])->assertStatus(403);
        $this->postJson('/api/v1/auth/switch-organization', ['organizationId' => $a['org']->id], $a['headers'])->assertOk();
    }
}
