<?php

namespace Database\Factories;

use App\Models\Contact;
use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Contact> */
class ContactFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organizationId' => Organization::factory(),
            'name' => fake()->name(),
            'phone' => '+8801'.fake()->unique()->numerify('8########'),
            'tags' => [],
            'customFields' => (object) [],
            'consentStatus' => 'UNKNOWN',
        ];
    }
}
