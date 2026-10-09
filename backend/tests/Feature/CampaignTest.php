<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\CampaignRecipient;
use App\Models\Contact;
use App\Models\ContactGroup;
use App\Models\Message;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Services\Campaign\CampaignRunner;
use App\Services\Messaging\DispatcherService;
use App\Services\Messaging\WorkerService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class CampaignTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
    }

    private function compose(array $over = []): array
    {
        return $over + ['name' => 'Launch', 'smsType' => 'TRANSACTIONAL', 'message' => 'Hello {{name}}', 'numbers' => "01712345671\n01712345672, 01712345673 bad", 'scheduleMode' => 'now'];
    }

    public function test_draft_create_update_and_delete(): void
    {
        $t = $this->tenant();
        $id = $this->postJson('/api/v1/app/campaigns', $this->compose(['message' => 'Draft text']), $t['headers'])->assertCreated()->assertJsonPath('data.status', 'DRAFT')->json('data.id');
        $this->putJson("/api/v1/app/campaigns/{$id}", $this->compose(['message' => 'Edited']), $t['headers'])->assertOk()->assertJsonPath('data.message', 'Edited');
        $this->getJson('/api/v1/app/campaigns', $t['headers'])->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('meta.statusCounts.DRAFT', 1);
        $this->deleteJson("/api/v1/app/campaigns/{$id}", [], $t['headers'])->assertOk();
        $this->getJson("/api/v1/app/campaigns/{$id}", $t['headers'])->assertStatus(404);
    }

    public function test_composer_config_returns_rules_rates_and_balance_of_the_session_organization(): void
    {
        $t = $this->tenant('12.5');
        $this->getJson('/api/v1/app/sms/composer', $t['headers'])
            ->assertOk()
            ->assertJsonPath('data.segmentation.gsm7.single', 160)
            ->assertJsonPath('data.segmentation.maxSegments', 10)
            ->assertJsonPath('data.promotionalOptOutText', 'Reply STOP to opt out')
            ->assertJsonPath('data.rates.transactionalNonMasking', '0.4000')
            ->assertJsonPath('data.rates.promotionalMasking', '0.6000')
            ->assertJsonPath('data.balance', '12.5000');
        // The balance is always the session organization's (no organization parameter exists).
        $other = $this->tenant('3');
        $this->getJson('/api/v1/app/sms/composer?organizationId='.$t['org']->id, $other['headers'])->assertOk()->assertJsonPath('data.balance', '3.0000');
        // Without campaigns:write (VIEWER) the composer configuration is not available.
        $viewer = $this->tenant('1', 'VIEWER');
        $this->getJson('/api/v1/app/sms/composer', $viewer['headers'])->assertForbidden();
        $this->getJson('/api/v1/app/sms/composer')->assertUnauthorized();
    }

    public function test_estimate_reports_audience_cost_and_balance(): void
    {
        $t = $this->tenant('1.00');
        $this->postJson('/api/v1/app/campaigns/estimate', $this->compose(), $t['headers'])
            ->assertOk()
            ->assertJsonPath('data.total', 4)->assertJsonPath('data.included', 3)->assertJsonPath('data.skipped', 1)
            ->assertJsonPath('data.estimatedCost', '1.20')->assertJsonPath('data.sufficientBalance', false)->assertJsonPath('data.requiresReview', false);
        $this->assertSame(0, Campaign::query()->count());
    }

    public function test_send_now_launches_charges_once_and_dispatches(): void
    {
        $t = $this->tenant('10');
        Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801712345671', 'name' => 'Karim']);
        $res = $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $t['headers'])->assertStatus(202)->assertJsonPath('meta.message', 'Sending started.');
        $id = $res->json('data.id');

        // The launch job ran (sync queue): charged once for 3 recipients, messages queued then sent inline.
        $c = Campaign::query()->findOrFail($id);
        $this->assertSame('PROCESSING', $c->status->value);
        $this->assertSame([4, 1, '1.2000'], [$c->recipientCount, $c->skippedCount, (string) $c->actualCost]);
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'SMS_CHARGE')->where('referenceType', 'campaign')->where('referenceId', $id)->count());
        $this->assertSame('8.8000', $this->balance($t['org']));
        $this->assertSame(3, Message::query()->where('campaignId', $id)->count());
        $this->assertSame(1, CampaignRecipient::query()->where('campaignId', $id)->where('status', 'SKIPPED_INVALID')->count());
        $this->assertSame(3, Message::query()->where('campaignId', $id)->where('status', 'SUBMITTED')->count());

        // Launching again (retried job / worker) cannot charge a second time.
        $this->assertFalse(app(CampaignRunner::class)->launch($id)['launched']);
        $this->assertSame('8.8000', $this->balance($t['org']));

        // Delivery + finalisation by the worker.
        $this->travel(10)->seconds();
        app(WorkerService::class)->tick();
        $c->refresh();
        $this->assertSame('COMPLETED', $c->status->value);
        $this->assertSame(3, $c->deliveredCount);
        $this->getJson("/api/v1/app/campaigns/{$id}", $t['headers'])->assertOk()->assertJsonPath('data.stats.delivered', 3)->assertJsonPath('data.skipped.SKIPPED_INVALID', 1);
    }

    public function test_insufficient_balance_blocks_submission(): void
    {
        $t = $this->tenant('0.50');
        $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $t['headers'])->assertStatus(402)->assertJsonPath('error.code', 'INSUFFICIENT_BALANCE');
        $this->assertSame(0, Campaign::query()->count());
    }

    public function test_review_is_required_for_promotional_when_the_account_requires_it(): void
    {
        $t = $this->tenant('10', 'OWNER', ['requireCampaignReview' => true]);
        $this->postJson('/api/v1/app/campaigns/submit', $this->compose(['smsType' => 'PROMOTIONAL']), $t['headers'])->assertStatus(202)->assertJsonPath('data.status', 'PENDING_REVIEW');
        $this->assertSame(0, Message::query()->count());
        $this->assertSame('10.0000', $this->balance($t['org']));
    }

    public function test_schedule_later_then_scheduler_launches_when_due(): void
    {
        $t = $this->tenant('10');
        $id = $this->postJson('/api/v1/app/campaigns/submit', $this->compose(['scheduleMode' => 'later', 'scheduledAt' => '2026-10-07T15:30']), $t['headers'])
            ->assertStatus(202)->assertJsonPath('data.status', 'SCHEDULED')->assertJsonPath('data.scheduledAt', '2026-10-07T09:30:00.000Z')->json('data.id');
        app(WorkerService::class)->tick();
        $this->assertSame('SCHEDULED', Campaign::query()->findOrFail($id)->status->value);
        $this->travelTo(CarbonImmutable::parse('2026-10-07 15:31', 'Asia/Dhaka'));
        app(WorkerService::class)->tick();
        // Launched, sent and (queue drained) finalised in one tick, exactly like the Node worker.
        $this->assertContains(Campaign::query()->findOrFail($id)->status->value, ['PROCESSING', 'COMPLETED']);
        $this->assertSame(3, Message::query()->where('campaignId', $id)->count());
        $this->postJson('/api/v1/app/campaigns/submit', $this->compose(['scheduleMode' => 'later', 'scheduledAt' => '2026-10-07T10:00']), $t['headers'])->assertStatus(422)->assertJsonPath('error.details.field', 'scheduledAt');
    }

    public function test_draft_send_endpoint_and_double_submit_of_a_draft(): void
    {
        $t = $this->tenant('10');
        $id = $this->postJson('/api/v1/app/campaigns', $this->compose(), $t['headers'])->json('data.id');
        $this->postJson("/api/v1/app/campaigns/{$id}/send", [], $t['headers'])->assertStatus(202);
        $this->postJson("/api/v1/app/campaigns/{$id}/send", [], $t['headers'])->assertStatus(409);
        $this->assertSame(1, WalletTransaction::query()->where('reason', 'SMS_CHARGE')->count());
    }

    public function test_idempotent_submission_creates_one_campaign(): void
    {
        $t = $this->tenant('10');
        $h = $t['headers'] + ['Idempotency-Key' => 'submit-1'];
        $a = $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $h)->assertStatus(202)->json('data.id');
        $b = $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $h)->assertStatus(202)->assertHeader('Idempotent-Replayed', 'true')->json('data.id');
        $this->assertSame($a, $b);
        $this->assertSame(1, Campaign::query()->count());
    }

    public function test_cancel_refunds_unsent_messages(): void
    {
        $t = $this->tenant('10');
        config(['smsflow.sms.inline_dispatch_max' => 0]); // keep messages queued
        $id = $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $t['headers'])->json('data.id');
        $this->assertSame('8.8000', $this->balance($t['org']));
        $this->postJson("/api/v1/app/campaigns/{$id}/pause", [], $t['headers'])->assertOk();
        $this->assertSame(0, app(DispatcherService::class)->processQueue()['claimed']); // paused: not sent
        $this->postJson("/api/v1/app/campaigns/{$id}/cancel", [], $t['headers'])->assertOk();
        $this->assertSame(3, Message::query()->where('campaignId', $id)->where('status', 'CANCELLED')->count());
        $this->assertSame('10.0000', $this->balance($t['org']));
        $this->assertSame('1.20', $this->getJson("/api/v1/app/campaigns/{$id}", $t['headers'])->json('data.campaign.refundedAmount'));
        $this->postJson("/api/v1/app/campaigns/{$id}/cancel", [], $t['headers'])->assertStatus(409);
    }

    public function test_group_audience_personalisation_and_promotional_opt_out(): void
    {
        $t = $this->tenant('10');
        $g = ContactGroup::query()->forceCreate(['organizationId' => $t['org']->id, 'name' => 'VIP']);
        $a = Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801712345671', 'name' => 'Asha', 'customFields' => ['city' => 'Dhaka']]);
        $b = Contact::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801712345672', 'name' => 'Bilal', 'consentStatus' => 'OPTED_OUT']);
        \DB::table('contact_group_members')->insert([['groupId' => $g->id, 'contactId' => $a->id, 'addedAt' => now()], ['groupId' => $g->id, 'contactId' => $b->id, 'addedAt' => now()]]);
        $id = $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'PROMOTIONAL', 'message' => 'Hi {{name}} from {{city}}', 'groupIds' => [$g->id], 'scheduleMode' => 'now'], $t['headers'])->assertStatus(202)->json('data.id');
        $this->assertSame(['Hi Asha from Dhaka'], Message::query()->where('campaignId', $id)->pluck('body')->all());
        $this->assertSame(1, CampaignRecipient::query()->where('campaignId', $id)->where('status', 'SKIPPED_SUPPRESSED')->count());
    }

    public function test_campaigns_are_tenant_scoped(): void
    {
        $a = $this->tenant('10');
        $b = $this->tenant('10');
        $id = $this->postJson('/api/v1/app/campaigns', $this->compose(), $a['headers'])->json('data.id');
        $this->getJson("/api/v1/app/campaigns/{$id}", $b['headers'])->assertStatus(404);
        $this->postJson("/api/v1/app/campaigns/{$id}/send", [], $b['headers'])->assertStatus(404);
        $this->deleteJson("/api/v1/app/campaigns/{$id}", [], $b['headers'])->assertStatus(404);
        $this->postJson('/api/v1/app/campaigns/submit', $this->compose(['groupIds' => [ContactGroup::query()->forceCreate(['organizationId' => $a['org']->id, 'name' => 'A'])->id]]), $b['headers'])->assertStatus(422);
    }

    public function test_unverified_email_and_viewer_cannot_send(): void
    {
        $t = $this->tenant('10', 'OWNER', [], ['emailVerifiedAt' => null]);
        $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $t['headers'])->assertStatus(403)->assertJsonPath('error.code', 'EMAIL_NOT_VERIFIED');
        $v = $this->tenant('10', 'VIEWER');
        $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $v['headers'])->assertStatus(403)->assertJsonPath('error.code', 'FORBIDDEN');
        $this->getJson('/api/v1/app/campaigns', $v['headers'])->assertOk();
    }

    public function test_failed_launch_can_be_retried_after_topping_up(): void
    {
        $t = $this->tenant('10');
        $id = $this->postJson('/api/v1/app/campaigns/submit', $this->compose(['scheduleMode' => 'later', 'scheduledAt' => '2026-10-07T13:00']), $t['headers'])->json('data.id');
        Wallet::query()->where('organizationId', $t['org']->id)->update(['balance' => '0']);
        $this->travelTo(CarbonImmutable::parse('2026-10-07 13:01', 'Asia/Dhaka'));
        app(WorkerService::class)->tick();
        $this->assertSame('FAILED', Campaign::query()->findOrFail($id)->status->value);
        Wallet::query()->where('organizationId', $t['org']->id)->update(['balance' => '10']);
        $this->postJson("/api/v1/app/campaigns/{$id}/retry", [], $t['headers'])->assertStatus(202);
        $this->assertSame('PROCESSING', Campaign::query()->findOrFail($id)->status->value);
        $this->assertSame('8.8000', $this->balance($t['org']));
    }

    public function test_campaign_report_export_is_csv(): void
    {
        $t = $this->tenant('10');
        $id = $this->postJson('/api/v1/app/campaigns/submit', $this->compose(), $t['headers'])->json('data.id');
        $res = $this->get("/api/v1/app/campaigns/{$id}/export", $t['headers'])->assertOk();
        $csv = $res->streamedContent();
        $this->assertStringContainsString('"phone","status"', $csv);
        $this->assertStringContainsString("\"'+8801712345671\"", $csv); // CSV-injection-safe quote prefix
        $this->assertStringContainsString('"bad","SKIPPED_INVALID"', $csv);
    }
}
