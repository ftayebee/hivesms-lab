<?php

namespace App\Auth;

/** Platform staff identity for admin services (port of features/admin/guard.ts AdminContext). */
final class AdminContext
{
    public function __construct(
        public readonly string $userId,
        public readonly string $name,
        public readonly string $role,
        public readonly ?string $ip = null,
        public readonly ?string $userAgent = null,
    ) {}

    /** @return array{type: string, userId: string} */
    public function actor(): array
    {
        return ['type' => 'ADMIN', 'userId' => $this->userId];
    }
}
