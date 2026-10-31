<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\OrganizationMember;
use App\Models\Role;
use App\Models\Session;
use App\Models\User;
use App\Support\Crypto;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * Cutover: a user logged in through the Next.js app (cookie `__Host-sf_session` holding a token
 * whose sha256 is in `sessions`) must be authenticated by Laravel with the same token, in the same
 * organization, with the same permissions — and logging out on either side ends the session for both.
 */
class AuthCutoverTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    /** Writes a session row exactly as src/lib/auth/session-store.ts createSession() does. */
    private function nodeSession(string $userId, ?string $orgId, int $days = 7): string
    {
        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '='); // randomBytes(32).toString("base64url")
        DB::table('sessions')->insert([
            'id' => (string) Str::uuid(),
            'tokenHash' => hash('sha256', $token),
            'userId' => $userId,
            'activeOrganizationId' => $orgId,
            'ipAddress' => '203.0.113.7',
            'userAgent' => 'Mozilla/5.0',
            'expiresAt' => now()->addDays($days)->format('Y-m-d H:i:s.v'),
            'lastSeenAt' => now()->subMinutes(10)->format('Y-m-d H:i:s.v'), // older than the 5-min touch interval
            'createdAt' => now()->subMinutes(10)->format('Y-m-d H:i:s.v'),
        ]);

        return $token;
    }

    public function test_existing_node_session_authenticates_with_its_organization_and_permissions(): void
    {
        $t = $this->tenant('10');
        Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801712345678', 'name' => 'Existing']);
        $token = $this->nodeSession($t['user']->id, $t['org']->id);
        $h = ['Authorization' => "Bearer {$token}"];

        $this->getJson('/api/v1/auth/me', $h)->assertOk()
            ->assertJsonPath('data.user.id', $t['user']->id)
            ->assertJsonPath('data.organization.id', $t['org']->id)
            ->assertJsonPath('data.organization.role', 'OWNER');
        $this->getJson('/api/v1/app/contacts', $h)->assertOk()->assertJsonPath('data.0.name', 'Existing');
        // lastSeenAt is touched like the Node app does (every 5 minutes).
        $this->assertTrue(Session::query()->where('tokenHash', hash('sha256', $token))->first()->lastSeenAt->gt(now()->subMinute()));
        // Logout through Laravel deletes the shared row: the Node app no longer finds the session either.
        $this->postJson('/api/v1/auth/logout', [], $h)->assertOk();
        $this->assertDatabaseMissing('sessions', ['tokenHash' => hash('sha256', $token)]);
    }

    public function test_node_session_respects_role_permissions_and_tenant_isolation(): void
    {
        $a = $this->tenant('10');
        $b = $this->tenant('10');
        $viewer = User::factory()->create();
        OrganizationMember::query()->forceCreate(['organizationId' => $a['org']->id, 'userId' => $viewer->id, 'roleId' => Role::query()->where('organizationId', $a['org']->id)->where('key', 'VIEWER')->value('id'), 'joinedAt' => now()]);
        $h = ['Authorization' => 'Bearer '.$this->nodeSession($viewer->id, $a['org']->id)];
        $this->getJson('/api/v1/app/contacts', $h)->assertOk();
        $this->postJson('/api/v1/app/contacts', ['phone' => '01712345678'], $h)->assertStatus(403);
        $this->getJson('/api/v1/app/wallet', $h)->assertStatus(403); // VIEWER has no billing:read
        $bContact = Contact::query()->forceCreate(['organizationId' => $b['org']->id, 'phone' => '+8801812345678']);
        $this->getJson("/api/v1/app/contacts/{$bContact->id}", $h)->assertStatus(404);
        // A session pointing at an organization the user does not belong to falls back to their own.
        $h2 = ['Authorization' => 'Bearer '.$this->nodeSession($viewer->id, $b['org']->id)];
        $this->getJson('/api/v1/auth/me', $h2)->assertOk()->assertJsonPath('data.organization.id', $a['org']->id);
    }

    public function test_staff_session_without_organization_reaches_admin(): void
    {
        $staff = User::factory()->platformRole('ADMIN')->create();
        $h = ['Authorization' => 'Bearer '.$this->nodeSession($staff->id, null)];
        $this->getJson('/api/v1/admin/customers', $h)->assertOk();
        $this->getJson('/api/v1/auth/me', $h)->assertOk()->assertJsonPath('data.organization', null)->assertJsonFragment(['admin:customers:manage']);
    }

    public function test_sessions_invalidated_by_node_rules_are_rejected(): void
    {
        $t = $this->tenant();
        // Created before the last password change (Node invalidates these).
        $token = $this->nodeSession($t['user']->id, $t['org']->id);
        $t['user']->forceFill(['passwordChangedAt' => now()])->save();
        $this->getJson('/api/v1/auth/me', ['Authorization' => "Bearer {$token}"])->assertStatus(401);
        // Disabled membership: authenticated, but no organization access.
        $u = User::factory()->create();
        OrganizationMember::query()->forceCreate(['organizationId' => $t['org']->id, 'userId' => $u->id, 'roleId' => Role::query()->where('organizationId', $t['org']->id)->where('key', 'MANAGER')->value('id'), 'status' => 'DISABLED', 'joinedAt' => now()]);
        $h = ['Authorization' => 'Bearer '.$this->nodeSession($u->id, $t['org']->id)];
        $this->getJson('/api/v1/auth/me', $h)->assertOk()->assertJsonPath('data.organization', null);
        $this->getJson('/api/v1/app/contacts', $h)->assertStatus(403)->assertJsonPath('error.message', 'No active organization.');
    }

    public function test_laravel_login_token_has_the_node_cookie_format(): void
    {
        $t = $this->tenant();
        $token = $this->postJson('/api/v1/auth/login', ['identifier' => $t['user']->email, 'password' => UserFactory::PASSWORD])->json('data.token');
        // 32 bytes base64url without padding = 43 chars: the value the Next.js cookie stores today.
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/', $token);
        $this->assertSame(1, Session::query()->where('tokenHash', Crypto::sha256($token))->count());
    }
}
