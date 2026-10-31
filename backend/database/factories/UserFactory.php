<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<User> */
class UserFactory extends Factory
{
    /** argon2id with the Node app's parameters (m=19456, t=2, p=1), computed once per test run. */
    private static ?string $passwordHash = null;

    public const PASSWORD = 'Test#Flow2026';

    public function definition(): array
    {
        self::$passwordHash ??= password_hash(self::PASSWORD, PASSWORD_ARGON2ID, ['memory_cost' => 19456, 'time_cost' => 2, 'threads' => 1]);

        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'phone' => '+8801'.fake()->unique()->numerify('7########'),
            'passwordHash' => self::$passwordHash,
            'platformRole' => 'USER',
            'status' => 'ACTIVE',
            'locale' => 'en',
            'emailVerifiedAt' => now(),
        ];
    }

    public function unverified(): static
    {
        return $this->state(['emailVerifiedAt' => null]);
    }

    public function platformRole(string $role): static
    {
        return $this->state(['platformRole' => $role]);
    }
}
