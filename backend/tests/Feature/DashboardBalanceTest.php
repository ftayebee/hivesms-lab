<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsTenants;
use Tests\TestCase;

class DashboardBalanceTest extends TestCase
{
    use BuildsTenants;
    use RefreshDatabase;

    public function test_balance_and_sms_quantity_follow_a_sent_message(): void
    {
        // Test plan rates: 0.40 non-masking, 0.60 masking.
        $t = $this->tenant('10');
        $this->getJson('/api/v1/app/dashboard', $t['headers'])->assertOk()
            ->assertJsonPath('data.balance.balance', '10.0000')
            ->assertJsonPath('data.balance.credits', 25)
            ->assertJsonPath('data.balance.maskingCredits', 16);

        $key = $this->apiKey($t['org']);
        $this->postJson('/api/v1/sms/send', ['to' => '01712345678', 'message' => 'hello'], $key['headers'])->assertStatus(202);

        $this->getJson('/api/v1/app/dashboard', $t['headers'])->assertOk()
            ->assertJsonPath('data.balance.balance', '9.6000')
            ->assertJsonPath('data.balance.credits', 24)
            ->assertJsonPath('data.balance.maskingCredits', 16);
    }
}
