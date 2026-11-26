<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Organization;
use App\Models\PricingPlan;
use App\Models\User;
use App\Models\Wallet;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

/** Super admins open customer accounts with a password (Admin → Customers → New customer). */
class AdminCreateCustomerTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    private const PW = 'Strong-Pass-2026';

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function body(array $over = []): array
    {
        return $over + ['company' => 'Acme Traders', 'name' => 'Rahim Uddin', 'email' => 'Rahim@Acme.test', 'phone' => '01712345678',
            'password' => self::PW, 'confirmPassword' => self::PW];
    }

    public function test_super_admin_creates_a_customer_who_can_sign_in(): void
    {
        $plan = PricingPlan::query()->where('active', true)->first();
        $res = $this->postJson('/api/v1/admin/customers', $this->body(['pricingPlanId' => $plan?->id]), $this->staff('SUPER_ADMIN'))->assertCreated();
        $orgId = $res->json('data.organizationId');

        $user = User::query()->where('email', 'rahim@acme.test')->firstOrFail();
        $this->assertNotNull($user->emailVerifiedAt);
        $this->assertSame('+8801712345678', $user->phone);
        $org = Organization::query()->findOrFail($orgId);
        $this->assertSame('Acme Traders', $org->name);
        $this->assertSame($plan?->id, $org->pricingPlanId);
        $this->assertTrue(Wallet::query()->where('organizationId', $orgId)->exists());
        $this->assertTrue($org->members()->where('userId', $user->id)->exists());
        $log = AuditLog::query()->where('action', 'admin.customer.create')->firstOrFail();
        $this->assertStringNotContainsString(self::PW, json_encode($log->metadata));

        $this->postJson('/api/v1/auth/login', ['identifier' => 'rahim@acme.test', 'password' => self::PW])->assertOk();
    }

    public function test_only_super_admins_and_input_is_validated(): void
    {
        $this->postJson('/api/v1/admin/customers', $this->body(), $this->staff('ADMIN'))->assertForbidden();
        $this->postJson('/api/v1/admin/customers', $this->body(), $this->tenant()['headers'])->assertForbidden();

        $sa = $this->staff('SUPER_ADMIN');
        $this->postJson('/api/v1/admin/customers', $this->body(['confirmPassword' => 'different-pass-1']), $sa)->assertStatus(422);
        $this->postJson('/api/v1/admin/customers', $this->body(['password' => 'short', 'confirmPassword' => 'short']), $sa)->assertStatus(422);
        $this->postJson('/api/v1/admin/customers', $this->body(['phone' => '12345']), $sa)->assertStatus(422);

        $this->postJson('/api/v1/admin/customers', $this->body(['phone' => null]), $sa)->assertCreated();
        $this->postJson('/api/v1/admin/customers', $this->body(['phone' => null, 'company' => 'Other']), $sa)->assertStatus(409)->assertJsonPath('error.details.field', 'email');
    }
}
