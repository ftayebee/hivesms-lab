<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Wallet;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Wallet> */
class WalletFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organizationId' => Organization::factory(),
            'balance' => '0',
            'currency' => 'BDT',
            'lowBalanceThreshold' => '100',
        ];
    }

    public function balance(string $amount): static
    {
        return $this->state(['balance' => $amount]);
    }
}
