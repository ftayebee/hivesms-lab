<?php

namespace Database\Factories;

use App\Models\Organization;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Organization> */
class OrganizationFactory extends Factory
{
    public function definition(): array
    {
        $name = fake()->company();

        return [
            'name' => $name,
            'slug' => Str::slug(Str::limit($name, 40, '')).'-'.Str::lower(Str::random(5)),
            'status' => 'ACTIVE',
            'country' => 'BD',
            'timezone' => 'Asia/Dhaka',
        ];
    }
}
