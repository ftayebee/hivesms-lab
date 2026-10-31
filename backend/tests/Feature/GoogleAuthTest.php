<?php

namespace Tests\Feature;

use App\Models\Session;
use App\Models\User;
use App\Services\Auth\SessionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class GoogleAuthTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const BODY = ['code' => 'auth-code', 'codeVerifier' => 'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv'];

    protected function setUp(): void
    {
        parent::setUp();
        config(['services.google.client_id' => 'client-1', 'services.google.client_secret' => 'secret-1', 'smsflow.frontend_url' => 'https://panel.test']);
        $this->seedPlan();
    }

    /** @param array<string, mixed> $claims */
    private function fakeGoogle(array $claims = []): void
    {
        $payload = rtrim(strtr(base64_encode(json_encode($claims + [
            'iss' => 'https://accounts.google.com', 'aud' => 'client-1', 'exp' => now()->addHour()->getTimestamp(),
            'sub' => 'g-1', 'email' => 'New.Person@Example.com', 'email_verified' => true, 'name' => 'New Person',
        ])), '+/', '-_'), '=');
        Http::fake(['oauth2.googleapis.com/*' => Http::response(['id_token' => "h.{$payload}.s"])]);
    }

    public function test_providers_hide_google_until_it_is_configured(): void
    {
        $this->getJson('/api/v1/auth/providers')->assertOk()
            ->assertJsonPath('data.google.clientId', 'client-1')
            ->assertJsonPath('data.google.redirectUri', 'https://panel.test/api/auth/google/callback');

        config(['services.google.client_secret' => '']);
        $this->getJson('/api/v1/auth/providers')->assertOk()->assertJsonPath('data.google', null);
        $this->postJson('/api/v1/auth/google', self::BODY)->assertStatus(403);
    }

    public function test_signs_up_a_new_verified_customer_with_an_organization(): void
    {
        $this->fakeGoogle();
        $res = $this->postJson('/api/v1/auth/google', self::BODY)->assertStatus(201)->assertJsonPath('data.created', true);

        $user = User::query()->where('email', 'new.person@example.com')->sole();
        $this->assertNotNull($user->emailVerifiedAt);
        $this->assertSame('New Person', $user->name);
        $this->assertNull($user->phone);
        $this->assertSame('USER', $user->platformRole->value);
        $this->assertNotNull($res->json('data.organizationId'));
        $this->getJson('/api/v1/auth/me', ['Authorization' => 'Bearer '.$res->json('data.token')])->assertOk();

        Http::assertSent(fn (Request $q) => $q['code'] === 'auth-code' && $q['client_secret'] === 'secret-1'
            && $q['code_verifier'] === self::BODY['codeVerifier'] && $q['redirect_uri'] === 'https://panel.test/api/auth/google/callback');
    }

    public function test_signs_in_an_existing_verified_customer_and_keeps_the_password(): void
    {
        $t = $this->tenant('10', 'OWNER', [], ['email' => 'new.person@example.com', 'emailVerifiedAt' => now()]);
        $hash = $t['user']->passwordHash;
        $this->fakeGoogle();

        $this->postJson('/api/v1/auth/google', self::BODY)->assertOk()
            ->assertJsonPath('data.created', false)
            ->assertJsonPath('data.organizationId', $t['org']->id);
        $this->assertSame($hash, $t['user']->refresh()->passwordHash);
        $this->assertSame(1, User::query()->where('email', 'new.person@example.com')->count());
    }

    public function test_takes_an_unverified_signup_away_from_whoever_registered_it(): void
    {
        $t = $this->tenant('10', 'OWNER', [], ['email' => 'new.person@example.com', 'emailVerifiedAt' => null]);
        $hash = $t['user']->passwordHash;
        $this->fakeGoogle();

        $this->postJson('/api/v1/auth/google', self::BODY)->assertOk();

        $user = $t['user']->refresh();
        $this->assertNotNull($user->emailVerifiedAt);
        $this->assertNotSame($hash, $user->passwordHash);
        $this->assertNull(app(SessionService::class)->resolve($t['token']));
    }

    public function test_refuses_staff_and_suspended_accounts(): void
    {
        $this->fakeGoogle();
        $staff = User::factory()->platformRole('SUPER_ADMIN')->create(['email' => 'new.person@example.com']);
        $this->postJson('/api/v1/auth/google', self::BODY)->assertStatus(403);
        $this->assertSame(0, Session::query()->where('userId', $staff->id)->count());

        $staff->forceFill(['platformRole' => 'USER', 'status' => 'SUSPENDED'])->save();
        $this->postJson('/api/v1/auth/google', self::BODY)->assertStatus(403);
    }

    public function test_rejects_tokens_google_did_not_vouch_for(): void
    {
        foreach ([['email_verified' => false], ['aud' => 'someone-else'], ['iss' => 'https://evil.example'], ['exp' => now()->subMinute()->getTimestamp()]] as $bad) {
            Http::swap(new Factory);
            $this->fakeGoogle($bad);
            $this->postJson('/api/v1/auth/google', self::BODY)->assertStatus(401);
        }
        $this->assertSame(0, User::query()->count());

        Http::swap(new Factory);
        Http::fake(['oauth2.googleapis.com/*' => Http::response(['error' => 'invalid_grant'], 400)]);
        $this->postJson('/api/v1/auth/google', self::BODY)->assertStatus(401);
    }

    public function test_respects_closed_registration(): void
    {
        config(['smsflow.features.registration_open' => false]);
        $this->fakeGoogle();
        $this->postJson('/api/v1/auth/google', self::BODY)->assertStatus(403);
        $this->assertSame(0, User::query()->count());
    }
}
