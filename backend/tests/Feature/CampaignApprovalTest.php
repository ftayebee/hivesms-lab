<?php

namespace Tests\Feature;

use App\Models\Campaign;
use App\Models\SenderId;
use App\Models\SuppressionEntry;
use App\Services\Platform\SettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Routine campaigns are queued without admin approval; real controls stay (docs/21 §5). */
class CampaignApprovalTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(CarbonImmutable::parse('2026-10-07 12:00', 'Asia/Dhaka'));
    }

    private function numbers(int $n): string
    {
        return implode("\n", array_map(fn ($i) => '0171'.str_pad((string) $i, 7, '0', STR_PAD_LEFT), range(1, $n)));
    }

    public function test_large_routine_campaign_needs_no_approval(): void
    {
        // Older account so the new-account risk rule does not apply; promotional so the bulk-transactional rule does not.
        $t = $this->tenant('100000', 'OWNER', ['createdAt' => now()->subDays(30)]);
        app(SettingsService::class)->set('sms.policy', ['reviewThresholdRecipients' => 10]); // legacy setting is ignored
        app(SettingsService::class)->clearCache();
        $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'PROMOTIONAL', 'message' => 'Eid offer', 'numbers' => $this->numbers(6000), 'scheduleMode' => 'later', 'scheduledAt' => '2026-10-08T10:00'], $t['headers'])
            ->assertStatus(202)->assertJsonPath('data.status', 'SCHEDULED');
    }

    public function test_risk_controls_still_hold_suspicious_campaigns(): void
    {
        $t = $this->tenant('100');
        $this->postJson('/api/v1/app/campaigns/estimate', ['smsType' => 'TRANSACTIONAL', 'message' => 'Verify your account password at http://bit.ly/x', 'numbers' => '01712345678'], $t['headers'])
            ->assertOk()->assertJsonPath('data.requiresReview', true);
        $id = $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'TRANSACTIONAL', 'message' => 'Verify your account password at http://bit.ly/x', 'numbers' => '01712345678'], $t['headers'])
            ->assertStatus(202)->assertJsonPath('data.status', 'PENDING_REVIEW')->json('data.id');
        $this->assertNull(Campaign::query()->findOrFail($id)->startedAt);
        // Account-level control set by staff.
        $flagged = $this->tenant('100', 'OWNER', ['requireCampaignReview' => true]);
        $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'PROMOTIONAL', 'message' => 'Offer', 'numbers' => '01712345678', 'scheduleMode' => 'later', 'scheduledAt' => '2026-10-08T10:00'], $flagged['headers'])
            ->assertStatus(202)->assertJsonPath('data.status', 'PENDING_REVIEW');
        // Admin-configured size hold.
        app(SettingsService::class)->set('campaign.processing', ['risk' => ['holdAboveRecipients' => 2]]);
        app(SettingsService::class)->clearCache();
        $this->postJson('/api/v1/app/campaigns/estimate', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => $this->numbers(3)], $t['headers'])->assertOk()->assertJsonPath('data.requiresReview', true);
    }

    public function test_suspended_accounts_cannot_send(): void
    {
        $t = $this->tenant('100', 'OWNER', ['status' => 'SUSPENDED']);
        $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => '01712345678'], $t['headers'])->assertStatus(403);
    }

    public function test_unapproved_sender_ids_remain_blocked(): void
    {
        $t = $this->tenant('100');
        SenderId::query()->forceCreate(['organizationId' => $t['org']->id, 'value' => 'PENDINGCO', 'type' => 'MASKING', 'status' => 'PENDING', 'documents' => []]);
        $this->postJson('/api/v1/app/campaigns/submit', ['smsType' => 'TRANSACTIONAL', 'message' => 'Hi', 'numbers' => '01712345678', 'senderId' => 'PENDINGCO'], $t['headers'])
            ->assertJsonPath('error.code', 'SENDER_ID_NOT_APPROVED');
    }

    public function test_promotional_opt_outs_remain_skipped(): void
    {
        $t = $this->tenant('100');
        SuppressionEntry::query()->forceCreate(['organizationId' => $t['org']->id, 'phone' => '+8801712345678', 'reason' => 'OPT_OUT']);
        $this->postJson('/api/v1/app/campaigns/estimate', ['smsType' => 'PROMOTIONAL', 'message' => 'Offer', 'numbers' => "01712345678\n01812345678", 'scheduleMode' => 'later', 'scheduledAt' => '2026-10-08T10:00'], $t['headers'])
            ->assertOk()->assertJsonPath('data.included', 1)->assertJsonPath('data.skipped', 1);
    }
}
