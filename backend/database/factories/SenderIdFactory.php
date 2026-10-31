<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\SenderId;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<SenderId> */
class SenderIdFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organizationId' => Organization::factory(),
            'value' => strtoupper(fake()->unique()->lexify('BRAND???')),
            'type' => 'MASKING',
            'status' => 'PENDING',
            'documents' => [],
        ];
    }

    public function approved(): static
    {
        return $this->state(['status' => 'APPROVED', 'approvedAt' => now()]);
    }
}
