<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\Message;
use App\Models\PricingPlan;
use App\Models\SenderId;
use App\Models\Setting;
use App\Models\User;
use App\Models\WalletTransaction;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class AdminTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
    }

    public function test_customers_and_staff_roles_are_enforced_server_side(): void
    {
        $t = $this->tenant();
        $this->getJson('/api/v1/admin/customers', $t['headers'])->assertStatus(403)->assertJsonPath('error.message', 'Administrator access required.');
        $this->getJson('/api/v1/admin/customers')->assertStatus(401);
        $support = $this->staff('SUPPORT');
        $this->getJson('/api/v1/admin/customers', $support)->assertOk();
        $this->getJson('/api/v1/admin/users', $support)->assertStatus(403)->assertJsonPath('error.message', 'Your staff role does not allow this action.');
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'SUSPENDED', 'reason' => 'x'], $support)->assertStatus(403);
        $this->getJson('/api/v1/admin/settings', $this->staff('ADMIN'))->assertStatus(403);
        $this->getJson('/api/v1/admin/settings', $this->staff('SUPER_ADMIN'))->assertOk();
    }

    public function test_customer_list_contract_and_detail(): void
    {
        $t = $this->tenant('55.5');
        $admin = $this->staff('ADMIN');
        $this->getJson('/api/v1/admin/customers?q='.urlencode($t['user']->email), $admin)
            ->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.id', $t['org']->id)->assertJsonPath('data.0.balance', '55.50')->assertJsonPath('data.0.members', 1);
        $this->getJson("/api/v1/admin/customers/{$t['org']->id}", $admin)->assertOk()->assertJsonPath('data.wallet.balance', '55.5000');
        $this->getJson('/api/v1/admin/stats', $admin)->assertOk()->assertJsonStructure(['data' => ['users', 'organizations', 'sms_today', 'revenue_30d']]);
        $this->getJson('/api/v1/admin/overview', $admin)->assertOk()->assertJsonCount(30, 'data.series');
        $this->getJson('/api/v1/admin/badges', $this->staff('SUPPORT'))->assertOk()->assertJsonPath('data.pendingSenderIds', 0);
        $this->getJson('/api/v1/admin/wallets', $admin)->assertOk()->assertJsonPath('data.0.balance', '55.50')->assertJsonPath('meta.totalBalance', '55.50')->assertJsonPath('meta.belowThreshold', 1);
        $this->getJson('/api/v1/admin/wallets', $this->staff('SUPPORT'))->assertStatus(403);
    }

    public function test_suspension_pauses_campaigns_and_blocks_api_keys(): void
    {
        $t = $this->tenant('10');
        $k = $this->apiKey($t['org']);
        $c = Campaign::query()->forceCreate(['organizationId' => $t['org']->id, 'name' => 'S', 'smsType' => 'TRANSACTIONAL', 'senderValue' => 'x', 'senderType' => 'NON_MASKING', 'message' => 'm', 'encoding' => 'GSM7', 'segmentsPerMessage' => 1, 'status' => 'SCHEDULED', 'scheduledAt' => now()->addDay()]);
        $admin = $this->staff('ADMIN');
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'SUSPENDED'], $admin)->assertStatus(422);
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'SUSPENDED', 'reason' => 'Spam complaints'], $admin)->assertOk();
        $this->assertSame('PAUSED', $c->refresh()->status->value);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $k['headers'])->assertStatus(403);
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/status", ['status' => 'ACTIVE'], $admin)->assertOk();
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'x'], $k['headers'])->assertStatus(202);
    }

    public function test_wallet_adjustments_are_audited_and_cannot_overdraw(): void
    {
        $t = $this->tenant('5');
        $admin = $this->staff('ADMIN');
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/wallet-adjustments", ['direction' => 'CREDIT', 'amount' => 20.5, 'note' => 'Goodwill credit'], $admin)->assertCreated();
        $this->assertSame('25.5000', $this->balance($t['org']));
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/wallet-adjustments", ['direction' => 'DEBIT', 'amount' => 100, 'note' => 'Correction'], $admin)->assertStatus(402);
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/wallet-adjustments", ['direction' => 'DEBIT', 'amount' => 0.5, 'note' => 'Correction'], $admin)->assertCreated();
        $this->assertSame('25.0000', $this->balance($t['org']));
        $this->assertSame(2, WalletTransaction::query()->where('reason', 'ADJUSTMENT')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'admin.wallet.adjust', 'organizationId' => $t['org']->id]);
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/wallet-adjustments", ['direction' => 'CREDIT', 'amount' => 1, 'note' => 'x'], $this->staff('SUPPORT'))->assertStatus(403);
    }

    public function test_sender_id_approval_charges_fee_once_and_sets_default(): void
    {
        $t = $this->tenant('100');
        PricingPlan::query()->where('isDefault', true)->update(['senderIdFee' => '50']);
        $t['org']->forceFill(['pricingPlanId' => PricingPlan::query()->value('id')])->save();
        $s = SenderId::factory()->create(['organizationId' => $t['org']->id, 'value' => 'ACME']);
        $admin = $this->staff('ADMIN');
        $this->postJson("/api/v1/admin/sender-ids/{$s->id}/review", ['decision' => 'REJECTED'], $admin)->assertStatus(422);
        $this->postJson("/api/v1/admin/sender-ids/{$s->id}/review", ['decision' => 'APPROVED', 'provider_ref' => 'GP-1'], $admin)->assertOk()->assertJsonPath('data.status', 'APPROVED');
        $s->refresh();
        $this->assertTrue($s->isDefault);
        $this->assertSame('50.0000', $this->balance($t['org']));
        $this->postJson("/api/v1/admin/sender-ids/{$s->id}/review", ['decision' => 'SUSPENDED', 'reason' => 'Abuse'], $admin)->assertOk();
        $this->postJson("/api/v1/admin/sender-ids/{$s->id}/review", ['decision' => 'APPROVED'], $admin)->assertOk();
        $this->assertSame('50.0000', $this->balance($t['org'])); // re-approval after suspension: no second fee
    }

    public function test_campaign_review_approve_launches_and_reject_needs_reason(): void
    {
        $t = $this->tenant('10', 'OWNER', ['requireCampaignReview' => true]);
        $id = $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'PROMOTIONAL', 'message' => 'Sale', 'numbers' => '01712345671 01712345672', 'scheduleMode' => 'now'], $t['headers'])->assertStatus(202)->json('data.id');
        $support = $this->staff('SUPPORT');
        $this->getJson('/api/v1/admin/campaigns?status=PENDING_REVIEW', $support)->assertOk()->assertJsonPath('meta.total', 1);
        $this->postJson("/api/v1/admin/campaigns/{$id}/review", ['decision' => 'reject'], $support)->assertStatus(422);
        $this->postJson("/api/v1/admin/campaigns/{$id}/review", ['decision' => 'approve'], $support)->assertOk();
        $this->assertSame(2, Message::query()->where('campaignId', $id)->count());
        $this->postJson("/api/v1/admin/campaigns/{$id}/review", ['decision' => 'approve'], $support)->assertStatus(409);
    }

    public function test_user_access_management_keeps_one_super_admin(): void
    {
        $superHeaders = $this->staff('SUPER_ADMIN');
        $super = User::query()->where('platformRole', 'SUPER_ADMIN')->firstOrFail();
        $this->putJson("/api/v1/admin/users/{$super->id}/access", ['platformRole' => 'USER'], $superHeaders)->assertStatus(403); // not on yourself
        $other = User::factory()->platformRole('SUPER_ADMIN')->create();
        $this->putJson("/api/v1/admin/users/{$other->id}/access", ['platformRole' => 'ADMIN'], $superHeaders)->assertOk()->assertJsonPath('data.platformRole', 'ADMIN');
        $t = $this->tenant();
        $this->putJson("/api/v1/admin/users/{$t['user']->id}/access", ['status' => 'SUSPENDED'], $superHeaders)->assertOk();
        $this->getJson('/api/v1/auth/me', $t['headers'])->assertStatus(401);
    }

    public function test_settings_secrets_are_write_only_and_encrypted(): void
    {
        $super = $this->staff('SUPER_ADMIN');
        $res = $this->putJson('/api/v1/admin/settings/sms-provider', ['provider' => 'http', 'url' => 'https://gw.example.com/send', 'apiKey' => 'super-secret-key', 'webhookSecret' => 'wh-secret', 'clearSecrets' => false], $super)
            ->assertOk()->assertJsonPath('data.smsProvider.provider', 'http');
        $this->assertTrue($res->json('data.secrets')['sms.provider.apiKey']);
        $this->assertFalse($res->json('data.secrets')['sms.provider.apiSecret']);
        $raw = json_encode(Setting::query()->get()->toArray());
        $this->assertStringNotContainsString('super-secret-key', $raw);
        $this->assertStringNotContainsString('super-secret-key', $this->getJson('/api/v1/admin/settings', $super)->getContent());
        $this->putJson('/api/v1/admin/settings/sms-policy', ['gsmSingle' => 160, 'gsmMulti' => 153, 'ucsSingle' => 70, 'ucsMulti' => 67, 'maxSegments' => 5, 'quietStart' => 21, 'quietEnd' => 9, 'quietHoursEnabled' => false, 'reviewThresholdRecipients' => 5000, 'optOutKeywords' => 'STOP, বন্ধ'], $super)
            ->assertOk()->assertJsonPath('data.smsPolicy.segmentation.maxSegments', 5)->assertJsonPath('data.smsPolicy.promotionalQuietHours', null);
        $this->putJson('/api/v1/admin/settings/billing-policy', ['vatRatePercent' => 15, 'minimumTopUp' => 500, 'maximumTopUp' => 100, 'invoicePrefix' => 'INV'], $this->staff('ADMIN'))->assertStatus(422);
    }

    public function test_pricing_plans_blocklist_and_abuse_management(): void
    {
        $admin = $this->staff('ADMIN');
        $this->postJson('/api/v1/admin/pricing/plans', ['key' => 'pro', 'name' => 'Pro', 'minRechargeAmount' => 1000, 'transactionalNonMasking' => 0.3, 'transactionalMasking' => 0.5, 'promotionalNonMasking' => 0.3, 'promotionalMasking' => 0.5, 'senderIdFee' => 0, 'isDefault' => true, 'active' => true], $admin)
            ->assertCreated()->assertJsonPath('data.transactionalNonMasking', '0.3000');
        $this->assertSame(1, PricingPlan::query()->where('isDefault', true)->count());
        $this->postJson('/api/v1/admin/blocklist', ['type' => 'URL_DOMAIN', 'value' => 'https://Scam.example/path'], $this->staff('SUPPORT'))->assertCreated()->assertJsonPath('data.value', 'scam.example');
        $t = $this->tenant('10');
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'visit scam.example now'], $this->apiKey($t['org'])['headers'])->assertStatus(422)->assertJsonPath('error.code', 'CONTENT_BLOCKED');
        $this->postJson('/api/v1/public/abuse-reports', ['senderValue' => 'ACME', 'messageContent' => 'spam spam'])->assertCreated();
        $this->getJson('/api/v1/admin/abuse-reports', $admin)->assertOk()->assertJsonPath('meta.total', 1);
    }
}
