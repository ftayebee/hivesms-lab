<?php

namespace Tests\Feature;

use App\Models\CreditPackage;
use App\Models\Permission;
use App\Models\PricingPlan;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BootstrapCatalogTest extends TestCase
{
    use RefreshDatabase;

    public function test_fills_an_empty_database(): void
    {
        $this->artisan('platform:bootstrap-catalog')->assertSuccessful();
        $this->assertGreaterThan(0, Permission::query()->count());
        $this->assertSame(['business', 'enterprise', 'starter'], PricingPlan::query()->orderBy('key')->pluck('key')->all());
        $this->assertSame('starter', PricingPlan::query()->where('isDefault', true)->sole()->key);
        $this->assertSame(5, CreditPackage::query()->count());
        $this->getJson('/api/v1/public/pricing')->assertOk()->assertJsonCount(3, 'data.plans');
    }

    public function test_running_again_keeps_admin_edits(): void
    {
        $this->artisan('platform:bootstrap-catalog')->assertSuccessful();
        PricingPlan::query()->where('key', 'starter')->update(['name' => 'Edited']);
        CreditPackage::query()->where('name', 'BDT 500')->delete();

        $this->artisan('platform:bootstrap-catalog')->assertSuccessful();

        $this->assertSame('Edited', PricingPlan::query()->where('key', 'starter')->sole()->name);
        $this->assertSame(3, PricingPlan::query()->count());
        $this->assertSame(4, CreditPackage::query()->count());
    }
}
