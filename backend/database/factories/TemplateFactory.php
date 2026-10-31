<?php

namespace Database\Factories;

use App\Models\Organization;
use App\Models\Template;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Template> */
class TemplateFactory extends Factory
{
    public function definition(): array
    {
        return [
            'organizationId' => Organization::factory(),
            'name' => fake()->words(3, true),
            'body' => 'Hello {name}, your order {order} has shipped.',
            'smsType' => 'TRANSACTIONAL',
        ];
    }
}
