<?php

namespace Database\Factories;

use App\Models\ContactGroup;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ContactGroup> */
class ContactGroupFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organizationId' => Organization::factory(),
            'name' => fake()->unique()->words(2, true),
        ];
    }
}
