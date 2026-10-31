<?php

namespace Tests\Feature;

use App\Models\Contact;
use App\Models\Message;
use App\Models\OrganizationMember;
use App\Models\Payment;
use App\Models\SenderId;
use App\Models\WalletTransaction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/**
 * Generic IDOR sweep: every tenant route with a path parameter is called by the OWNER of
 * organization A with the id of every kind of resource belonging to organization B. No call may
 * succeed, and B's data must be unchanged afterwards. New routes are covered automatically.
 */
class IdorSweepTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    /** Route parameters that are not record ids (org-local keys). */
    private const NOT_IDS = ['api/v1/app/team/roles/{role}/permissions'];

    public function test_no_tenant_route_accepts_another_organizations_ids(): void
    {
        Mail::fake();
        $a = $this->tenant('100');
        $b = $this->tenant('100');
        $ids = $this->resourcesOf($b);
        $this->assertGreaterThanOrEqual(14, count($ids));
        $before = $this->fingerprint($b['org']->id);

        $routes = collect(Route::getRoutes()->getRoutes())->filter(fn ($r) => str_starts_with($r->uri(), 'api/v1/app/') && str_contains($r->uri(), '{') && ! in_array($r->uri(), self::NOT_IDS, true));
        $this->assertGreaterThan(40, $routes->count());
        $calls = 0;
        foreach ($routes as $route) {
            foreach (array_diff($route->methods(), ['HEAD']) as $method) {
                foreach ($ids as $kind => $id) {
                    $uri = preg_replace(['/\{index\}/', '/\{[a-zA-Z]+\}/'], ['0', $id], $route->uri());
                    $status = $this->json($method, '/'.$uri, ['name' => 'x', 'reason' => 'x', 'reference' => 'TRX1', 'outcome' => 'success', 'contactIds' => [$ids['contact']], 'role' => 'VIEWER', 'status' => 'DISABLED', 'message' => 'x'], $a['headers'])->status();
                    $this->assertFalse($status >= 200 && $status < 300, "{$method} /{$uri} ({$kind} of another organization) returned {$status}");
                    $calls++;
                }
            }
        }
        // The customer API too.
        $key = $this->apiKey($a['org']);
        $this->getJson("/api/v1/messages/{$ids['message']}", $key['headers'])->assertStatus(404);

        $this->assertGreaterThan(500, $calls);
        $this->assertSame($before, $this->fingerprint($b['org']->id), "organization B's data changed");
    }

    /** One record of every addressable kind in organization $t. @return array<string, string> */
    private function resourcesOf(array $t): array
    {
        $h = $t['headers'];
        $ids = [];
        $ids['contact'] = Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801712345678'])->id;
        $ids['group'] = $this->postJson('/api/v1/app/contact-groups', ['name' => 'B group'], $h)->assertCreated()->json('data.id');
        $ids['template'] = $this->postJson('/api/v1/app/templates', ['name' => 'B tpl', 'body' => 'Hello'], $h)->assertCreated()->json('data.id');
        $ids['campaign'] = $this->postJson('/api/v1/app/campaigns', ['name' => 'B', 'smsType' => 'TRANSACTIONAL', 'message' => 'hi', 'numbers' => '01712345671', 'scheduleMode' => 'now'], $h)->assertCreated()->json('data.id');
        $ids['message'] = $this->postJson('/api/v1/sms/send', ['to' => '01712345679', 'message' => 'hi'], $this->apiKey($t['org'])['headers'])->assertStatus(202)->json('data.message_id');
        $ids['apiKey'] = $this->apiKey($t['org'])['id'];
        $ids['senderId'] = SenderId::query()->forceCreate(['organizationId' => $t['org']->id, 'value' => 'BCOMPANY', 'type' => 'MASKING', 'purpose' => 'Brand', 'sampleMessage' => 'Hi', 'documents' => [['name' => 'a.pdf', 'path' => 'x']], 'status' => 'PENDING'])->id;
        $ids['webhook'] = $this->postJson('/api/v1/app/webhooks', ['url' => 'https://hooks.example.com/b', 'events' => ['message.delivered']], $h)->assertCreated()->json('data.id');
        $ids['ticket'] = $this->postJson('/api/v1/app/support/tickets', ['subject' => 'Delivery issue B', 'category' => 'Delivery', 'message' => 'Messages to Robi are failing.'], $h)->assertCreated()->json('data.id');
        $ids['suppression'] = $this->postJson('/api/v1/app/suppression', ['phone' => '01712345670', 'reason' => 'COMPLAINT'], $h)->assertCreated()->json('data.id');
        $ids['invitation'] = $this->postJson('/api/v1/app/team/invitations', ['email' => 'b.invitee@example.com', 'role' => 'MANAGER'], $h)->assertCreated()->json('data.id');
        $ids['member'] = OrganizationMember::query()->where('organizationId', $t['org']->id)->value('id');
        $pending = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'manual'], $h)->assertCreated()->json('data.payment.id');
        $ids['payment'] = $pending;
        $paid = $this->postJson('/api/v1/app/payments', ['amount' => 1000, 'provider' => 'mock'], $h)->json('data.payment.id');
        $this->postJson("/api/v1/app/payments/{$paid}/mock-complete", ['outcome' => 'success'], $h)->assertOk();
        $ids['invoice'] = DB::table('invoices')->where('paymentId', $paid)->value('id');
        $ids['transaction'] = WalletTransaction::query()->whereHas('wallet', fn ($q) => $q->where('organizationId', $t['org']->id))->value('id');
        $ids['import'] = (string) Str::uuid(); // imports are checked by org in ContactTest; random id must 404 too

        return array_filter($ids);
    }

    /** Snapshot of everything A might try to change in B. */
    private function fingerprint(string $orgId): string
    {
        $rows = [];
        foreach (['contacts', 'contact_groups', 'templates', 'campaigns', 'messages', 'api_keys', 'sender_ids', 'webhooks', 'support_tickets', 'suppression_entries', 'team_invitations', 'organization_members', 'payments', 'invoices'] as $table) {
            if (Schema::hasTable($table)) {
                $rows[$table] = DB::table($table)->where('organizationId', $orgId)->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();
            }
        }
        $rows['wallet'] = DB::table('wallets')->where('organizationId', $orgId)->value('balance');
        $rows['messagesQueued'] = Message::query()->where('organizationId', $orgId)->count();
        $rows['paymentsPending'] = Payment::query()->where('organizationId', $orgId)->where('status', 'PENDING')->count();

        return hash('sha256', json_encode($rows));
    }
}
