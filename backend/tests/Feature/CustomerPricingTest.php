<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\PricingPlan;
use App\Models\User;
use App\Services\Auth\PasswordHasher;
use App\Services\Auth\SessionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class CustomerPricingTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const PASSWORD = 'Correct-Horse-9931';

    /** @return array<string, string> */
    private function owner(): array
    {
        $user = User::factory()->platformRole('SUPER_ADMIN')->create(['passwordHash' => app(PasswordHasher::class)->hash(self::PASSWORD)]);
        $token = app(SessionService::class)->create($user->id, null, false, '127.0.0.1', 'phpunit')['token'];

        return ['Authorization' => "Bearer {$token}"];
    }

    /** @return array<string, string> */
    private function body(string $masking = '0.45', string $nonMasking = '0.25'): array
    {
        return ['maskingRate' => $masking, 'nonMaskingRate' => $nonMasking, 'reason' => 'Agreed volume deal', 'currentPassword' => self::PASSWORD];
    }

    public function test_one_customers_price_changes_what_it_is_charged_and_nobody_elses(): void
    {
        $vip = $this->tenant('10');
        $other = $this->tenant('10');

        $this->putJson("/api/v1/admin/customers/{$vip['org']->id}/pricing", $this->body(), $this->owner())->assertOk()
            ->assertJsonPath('data.custom', true)
            ->assertJsonPath('data.maskingRate', '0.4500')
            ->assertJsonPath('data.nonMaskingRate', '0.2500');

        $this->getJson('/api/v1/app/dashboard', $vip['headers'])->assertOk()
            ->assertJsonPath('data.balance.credits', 40)
            ->assertJsonPath('data.balance.maskingCredits', 22);
        $this->getJson('/api/v1/app/dashboard', $other['headers'])->assertOk()
            ->assertJsonPath('data.balance.credits', 25)
            ->assertJsonPath('data.balance.maskingCredits', 16);

        $key = $this->apiKey($vip['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $key['headers'])->assertStatus(202);
        $this->getJson('/api/v1/app/dashboard', $vip['headers'])->assertOk()->assertJsonPath('data.balance.balance', '9.7500');
    }

    public function test_changing_again_updates_the_same_private_plan_and_is_audited(): void
    {
        $org = $this->tenant()['org'];
        $owner = $this->owner();
        $this->putJson("/api/v1/admin/customers/{$org->id}/pricing", $this->body(), $owner)->assertOk();
        $this->putJson("/api/v1/admin/customers/{$org->id}/pricing", $this->body('0.55', '0.30'), $owner)->assertOk()
            ->assertJsonPath('data.maskingRate', '0.5500');

        $this->assertSame(1, PricingPlan::query()->where('key', "customer-{$org->id}")->count());
        $log = AuditLog::query()->where('action', 'admin.organization.pricing_update')->orderByDesc('createdAt')->get();
        $this->assertCount(2, $log);
        $this->assertSame('Agreed volume deal', $log[0]->metadata['reason']);
        $this->assertStringNotContainsString(self::PASSWORD, json_encode($log[0]->metadata));
    }

    public function test_reset_returns_the_customer_to_the_default_plan(): void
    {
        $t = $this->tenant('10');
        $owner = $this->owner();
        $this->putJson("/api/v1/admin/customers/{$t['org']->id}/pricing", $this->body(), $owner)->assertOk();

        $reset = ['reason' => 'Deal has ended', 'currentPassword' => self::PASSWORD];
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/pricing/reset", $reset, $owner)->assertOk()
            ->assertJsonPath('data.custom', false)
            ->assertJsonPath('data.nonMaskingRate', '0.4000');

        $this->assertSame(0, PricingPlan::query()->where('key', "customer-{$t['org']->id}")->count());
        $this->assertNull($t['org']->refresh()->pricingPlanId);
        $this->postJson("/api/v1/admin/customers/{$t['org']->id}/pricing/reset", $reset, $owner)->assertStatus(409);
    }

    public function test_private_plans_stay_out_of_public_and_plan_lists(): void
    {
        $org = $this->tenant()['org'];
        $owner = $this->owner();
        $this->putJson("/api/v1/admin/customers/{$org->id}/pricing", $this->body(), $owner)->assertOk();

        $this->assertStringNotContainsString('Custom:', $this->getJson('/api/v1/public/pricing')->assertOk()->getContent());
        $this->assertStringNotContainsString('Custom:', $this->getJson('/api/v1/admin/pricing/plans', $owner)->assertOk()->getContent());
        $this->assertContains('Custom pricing', array_column($this->getJson('/api/v1/admin/dashboard', $owner)->assertOk()->json('data.plans'), 'name'));
    }

    public function test_controls_cannot_assign_another_customers_private_plan(): void
    {
        $a = $this->tenant()['org'];
        $b = $this->tenant()['org'];
        $owner = $this->owner();
        $this->putJson("/api/v1/admin/customers/{$a->id}/pricing", $this->body(), $owner)->assertOk();
        $privatePlan = $a->refresh()->pricingPlanId;
        $controls = ['dailySendLimit' => 100, 'monthlySendLimit' => 1000, 'requireCampaignReview' => false];

        $this->putJson("/api/v1/admin/customers/{$b->id}/controls", $controls + ['pricingPlanId' => $privatePlan], $owner)->assertStatus(422);
        $this->putJson("/api/v1/admin/customers/{$a->id}/controls", $controls + ['pricingPlanId' => $privatePlan], $owner)->assertOk();
    }

    public function test_only_a_super_admin_with_the_password_and_a_valid_price_can_change_it(): void
    {
        $t = $this->tenant();
        $url = "/api/v1/admin/customers/{$t['org']->id}/pricing";

        $this->putJson($url, $this->body())->assertUnauthorized();
        $this->putJson($url, $this->body(), $t['headers'])->assertForbidden();
        $this->putJson($url, $this->body(), $this->staff('SUPPORT'))->assertForbidden();
        $this->putJson($url, $this->body(), $this->staff('ADMIN'))->assertForbidden();
        $this->postJson("{$url}/reset", ['reason' => 'Deal has ended', 'currentPassword' => 'x'], $this->staff('ADMIN'))->assertForbidden();
        $this->getJson($url, $this->staff('SUPPORT'))->assertOk();

        $owner = $this->owner();
        $this->putJson($url, ['currentPassword' => 'wrong'] + $this->body(), $owner)->assertStatus(422);
        foreach (['0', '0.00', '-1', 'abc', '1.23456'] as $bad) {
            $this->putJson($url, $this->body($bad), $owner)->assertStatus(422);
        }
        $this->assertNull($t['org']->refresh()->pricingPlanId);
    }
}
