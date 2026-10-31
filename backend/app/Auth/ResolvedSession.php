<?php

namespace App\Auth;

use App\Models\User;
use Carbon\CarbonImmutable;

/** A valid dashboard session (port of ResolvedSession in src/lib/auth/session-store.ts). */
final class ResolvedSession
{
    public function __construct(
        public readonly string $sessionId,
        public readonly User $user,
        public readonly ?string $activeOrganizationId,
        public readonly CarbonImmutable $expiresAt,
    ) {}
}
