<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\ContactGroup;
use App\Models\Invitation;
use App\Models\Notification;
use App\Models\OrganizationMember;
use App\Models\Role;
use App\Models\User;
use App\Services\Auth\SessionService;
use App\Services\Messaging\DispatcherService;
use App\Support\Crypto;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Dashboard, reports, templates, team, support, profile, notifications. */
class DashboardModulesTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
    }

    public function test_dashboard_and_reports_aggregate_in_sql(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'a'], $k['headers']);
        $this->postJson('/api/v1/sms/send', ['to' => '01812340000', 'message' => 'b'], $k['headers']);
        app(DispatcherService::class)->processQueue();

        $d = $this->getJson('/api/v1/app/dashboard?range=7d', $t['headers'])->assertOk();
        $d->assertJsonPath('data.totals.total', 2)->assertJsonPath('data.totals.sent', 1)->assertJsonPath('data.totals.failed', 1)
            ->assertJsonPath('data.balance.balance', '9.6000')->assertJsonCount(7, 'data.daily')->assertJsonPath('data.range.key', '7d');
        $this->assertSame('0.40', $d->json('data.spend.net'));

        // Billing figures are hidden from members without billing:read.
        $this->getJson('/api/v1/app/dashboard', $this->tenantMember($t, 'DEVELOPER'))->assertOk()->assertJsonPath('data.balance', null);

        $this->getJson('/api/v1/app/reports/delivery?status=rejected', $t['headers'])->assertOk()->assertJsonPath('data.totals.failed', 1)->assertJsonPath('data.failures.0.count', 1);
        $msgs = $this->getJson('/api/v1/app/messages?phone=01712345678', $t['headers'])->assertOk()->assertJsonPath('meta.total', 1);
        $id = $msgs->json('data.0.id');
        $this->getJson("/api/v1/app/messages/{$id}", $t['headers'])->assertOk()->assertJsonPath('data.status', 'SUBMITTED')->assertJsonCount(1, 'data.events');
        $this->getJson("/api/v1/app/messages/{$id}", $this->tenant()['headers'])->assertStatus(404);
        $this->getJson('/api/v1/app/reports/usage', $t['headers'])->assertOk()->assertJsonPath('data.segments', 2);
        $this->assertStringContainsString('"message_id"', $this->get('/api/v1/app/reports/export?range=7d', $t['headers'])->streamedContent());
        $this->getJson('/api/v1/app/reports/campaigns', $t['headers'])->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson('/api/v1/app/reports/filters', $t['headers'])->assertOk()->assertJsonPath('data.senders', ['8809600000000']);
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertOk()->assertJsonPath('data.organization.balance', '9.60')->assertJsonPath('data.organization.unreadNotifications', 1); // balance 9.60 < default threshold 100
        $this->assertTrue(Notification::query()->where('userId', $t['user']->id)->where('type', 'balance.low')->exists());
    }

    /** Another member of the same organization with the given role. */
    private function tenantMember(array $t, string $role): array
    {
        $u = User::factory()->create();
        OrganizationMember::query()->forceCreate(['organizationId' => $t['org']->id, 'userId' => $u->id, 'roleId' => Role::query()->where('organizationId', $t['org']->id)->where('key', $role)->value('id'), 'joinedAt' => now()]);

        return ['Authorization' => 'Bearer '.app(SessionService::class)->create($u->id, $t['org']->id, false, null, null)['token']];
    }

    public function test_templates_crud_validation_and_scope(): void
    {
        $t = $this->tenant();
        $id = $this->postJson('/api/v1/app/templates', ['name' => 'OTP', 'body' => 'Your code is {{code}}'], $t['headers'])->assertCreated()
            ->assertJsonPath('data.variables', ['code'])->assertJsonPath('data.smsType', 'TRANSACTIONAL')->assertJsonPath('data.segments', 1)->json('data.id');
        $this->postJson('/api/v1/app/templates', ['name' => 'Bad', 'body' => 'Hi {{ first name }}'], $t['headers'])->assertStatus(422);
        $this->postJson('/api/v1/app/templates', ['name' => 'Long', 'body' => str_repeat('ক', 1000)], $t['headers'])->assertStatus(422);
        $this->putJson("/api/v1/app/templates/{$id}", ['name' => 'OTP v2', 'body' => 'Code {{code}}', 'smsType' => 'TRANSACTIONAL'], $t['headers'])->assertOk()->assertJsonPath('data.name', 'OTP v2');
        $this->getJson('/api/v1/app/templates?q=v2', $t['headers'])->assertJsonCount(1, 'data');
        $this->getJson("/api/v1/app/templates/{$id}", $this->tenant()['headers'])->assertStatus(404);
        $this->deleteJson("/api/v1/app/templates/{$id}", [], $t['headers'])->assertOk();
        $this->getJson('/api/v1/app/templates', $t['headers'])->assertJsonCount(0, 'data');
    }

    public function test_team_invitation_flow_and_owner_protection(): void
    {
        $t = $this->tenant();
        $this->postJson('/api/v1/app/team/invitations', ['email' => 'New.Member@Example.com', 'role' => 'MANAGER'], $t['headers'])->assertCreated()->assertJsonPath('data.email', 'new.member@example.com');
        $token = Crypto::randomToken(32);
        Invitation::query()->update(['tokenHash' => Crypto::sha256($token)]);
        $this->getJson("/api/v1/auth/invitations/{$token}")->assertOk()->assertJsonPath('data.role', 'Manager')->assertJsonPath('data.accountExists', false);
        $signup = $this->postJson('/api/v1/auth/invitations/signup', ['token' => $token, 'name' => 'New Member', 'password' => 'Welcome2026x', 'confirmPassword' => 'Welcome2026x'])->assertCreated();
        $headers = ['Authorization' => 'Bearer '.$signup->json('data.token')];
        $this->getJson('/api/v1/auth/me', $headers)->assertJsonPath('data.organization.role', 'MANAGER');
        $this->postJson('/api/v1/auth/invitations/signup', ['token' => $token, 'name' => 'Again', 'password' => 'Welcome2026x', 'confirmPassword' => 'Welcome2026x'])->assertStatus(400);

        $team = $this->getJson('/api/v1/app/team', $t['headers'])->assertOk()->assertJsonCount(2, 'data.members');
        $ownerMember = collect($team->json('data.members'))->firstWhere('userId', $t['user']->id)['id'];
        // Managers cannot manage the team; the only owner cannot be demoted.
        $this->putJson("/api/v1/app/team/members/{$ownerMember}/role", ['role' => 'VIEWER'], $headers)->assertStatus(403);
        $this->putJson("/api/v1/app/team/members/{$ownerMember}/role", ['role' => 'VIEWER'], $t['headers'])->assertStatus(403); // own role
        $this->putJson('/api/v1/app/team/roles/MANAGER/permissions', ['permissions' => ['dashboard:read', 'bogus:perm']], $t['headers'])->assertOk();
        $this->getJson('/api/v1/app/contacts', $headers)->assertStatus(403); // permission removed, effective immediately
        $this->putJson('/api/v1/app/team/roles/OWNER/permissions', ['permissions' => []], $t['headers'])->assertStatus(403);
    }

    public function test_support_tickets_hide_internal_notes(): void
    {
        $t = $this->tenant();
        $id = $this->postJson('/api/v1/app/support/tickets', ['subject' => 'Delivery issue', 'category' => 'Delivery', 'message' => 'Messages to Robi are failing.'], $t['headers'])
            ->assertCreated()->assertJsonPath('data.status', 'OPEN')->json('data.id');
        $staff = $this->staff('SUPPORT');
        $this->postJson("/api/v1/admin/support/tickets/{$id}/messages", ['body' => 'internal: check route', 'internal' => true], $staff)->assertCreated();
        $this->postJson("/api/v1/admin/support/tickets/{$id}/messages", ['body' => 'We are checking.'], $staff)->assertCreated();
        $customerView = $this->getJson("/api/v1/app/support/tickets/{$id}", $t['headers'])->assertOk()->assertJsonPath('data.status', 'WAITING_FOR_CUSTOMER');
        $this->assertStringNotContainsString('internal: check route', $customerView->getContent());
        $this->assertCount(2, $customerView->json('data.messages'));
        $this->assertCount(3, $this->getJson("/api/v1/admin/support/tickets/{$id}", $staff)->json('data.messages'));
        $this->postJson("/api/v1/app/support/tickets/{$id}/messages", ['body' => 'Thanks'], $t['headers'])->assertCreated();
        $this->postJson("/api/v1/app/support/tickets/{$id}/close", [], $t['headers'])->assertOk();
        $this->postJson("/api/v1/app/support/tickets/{$id}/messages", ['body' => 'more'], $t['headers'])->assertStatus(409);
        $this->getJson("/api/v1/app/support/tickets/{$id}", $this->tenant()['headers'])->assertStatus(404);
        $this->assertTrue(Notification::query()->where('userId', $t['user']->id)->where('type', 'support.updated')->exists());
    }

    public function test_profile_organization_sessions_and_notifications(): void
    {
        $t = $this->tenant();
        $this->putJson('/api/v1/profile', ['name' => 'Renamed', 'phone' => '01912345678', 'locale' => 'bn'], $t['headers'])->assertOk()->assertJsonPath('data.phone', '+8801912345678')->assertJsonPath('data.locale', 'bn');
        $this->putJson('/api/v1/app/organization', ['name' => 'New Org', 'website' => 'not a url'], $t['headers'])->assertStatus(422);
        $this->putJson('/api/v1/app/organization', ['name' => 'New Org', 'billingEmail' => 'BILL@x.com'], $t['headers'])->assertOk()->assertJsonPath('data.billingEmail', 'bill@x.com');
        $this->putJson('/api/v1/app/organization', ['name' => 'X'], $this->tenantMember($t, 'MANAGER'))->assertStatus(403);
        $sessions = $this->getJson('/api/v1/profile/sessions', $t['headers'])->assertOk();
        $this->assertTrue($sessions->json('data.0.current'));
        $this->deleteJson('/api/v1/profile/sessions/'.$sessions->json('data.0.id'), [], $t['headers'])->assertStatus(422);
        Notification::query()->forceCreate(['organizationId' => $t['org']->id, 'userId' => $t['user']->id, 'type' => 'balance.low', 'title' => 'Low', 'body' => 'b']);
        $this->getJson('/api/v1/app/notifications', $t['headers'])->assertOk()->assertJsonPath('meta.unread', 1);
        $this->postJson('/api/v1/app/notifications/read', [], $t['headers'])->assertOk()->assertJsonPath('data.updated', 1);
        $this->putJson('/api/v1/profile/notification-preferences', ['preferences' => [['type' => 'balance.low', 'inApp' => false, 'email' => false]]], $t['headers'])->assertOk();
        $prefs = collect($this->getJson('/api/v1/profile/notification-preferences', $t['headers'])->json('data'))->keyBy('type');
        $this->assertFalse($prefs['balance.low']['inApp']);
    }

    public function test_list_endpoints_use_a_constant_number_of_queries(): void
    {
        $t = $this->tenant('10');
        $g = ContactGroup::query()->forceCreate(['organizationId' => $t['org']->id, 'name' => 'G']);
        $count = function (string $url) use ($t): int {
            \DB::flushQueryLog();
            \DB::enableQueryLog();
            $this->getJson($url, $t['headers'])->assertOk();
            $n = count(\DB::getQueryLog());
            \DB::disableQueryLog();

            return $n;
        };
        $add = function (int $n) use ($t, $g) {
            for ($i = 0; $i < $n; $i++) {
                $c = Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801'.random_int(300000000, 999999999)]);
                \DB::table('contact_group_members')->insert(['groupId' => $g->id, 'contactId' => $c->id, 'addedAt' => now()]);
            }
        };
        $add(2);
        $few = [$count('/api/v1/app/contacts'), $count('/api/v1/app/contact-groups'), $count('/api/v1/app/dashboard')];
        $add(20);
        $many = [$count('/api/v1/app/contacts'), $count('/api/v1/app/contact-groups'), $count('/api/v1/app/dashboard')];
        $this->assertSame($few, $many);
    }

    public function test_public_pricing_and_contact_form(): void
    {
        $this->seedPlan();
        $this->getJson('/api/v1/public/pricing')->assertOk()->assertJsonPath('data.plans.0.key', 'starter');
        $this->postJson('/api/v1/public/contact', ['name' => 'A', 'email' => 'x'])->assertStatus(422);
        $this->postJson('/api/v1/public/contact', ['name' => 'Asha', 'email' => 'a@x.com', 'subject' => 'Pricing', 'message' => 'Tell me about pricing please'])->assertCreated();
        $this->postJson('/api/v1/public/contact', ['name' => 'Bot', 'email' => 'b@x.com', 'subject' => 'Spam', 'message' => 'buy buy buy buy', 'website' => 'http://spam'])->assertOk();
        $this->assertDatabaseCount('contact_requests', 1);
    }
}
