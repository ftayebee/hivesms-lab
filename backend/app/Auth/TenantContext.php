<?php

namespace App\Auth;

use App\Exceptions\AppException;
use App\Support\ErrorCode;

/**
 * The identity every tenant-scoped service call runs under (port of src/lib/auth/context.ts).
 * Built from a session (dashboard) or from an API key (public API) — never from client input.
 * Services scope every query with $organizationId.
 */
final class TenantContext
{
    /** @param list<string> $permissions */
    public function __construct(
        public readonly string $organizationId,
        public readonly string $organizationStatus,
        public readonly ?string $userId,
        public readonly ?string $apiKeyId,
        public readonly ?string $roleKey,
        public readonly array $permissions,
        public readonly ?string $ip = null,
        public readonly ?string $userAgent = null,
    ) {}

    public function can(array|string $permission): bool
    {
        return Permissions::has($this->permissions, $permission);
    }

    public function requirePermission(array|string $permission): void
    {
        if (! $this->can($permission)) {
            throw new AppException(ErrorCode::FORBIDDEN, 'You do not have permission to perform this action.');
        }
    }

    public function assertActive(): void
    {
        if ($this->organizationStatus !== 'ACTIVE') {
            throw new AppException(ErrorCode::ACCOUNT_SUSPENDED, 'This account is suspended. Contact support to restore access.');
        }
    }

    /** @return array{type: string, userId?: string, apiKeyId?: string} */
    public function actor(): array
    {
        return $this->apiKeyId ? ['type' => 'API_KEY', 'apiKeyId' => $this->apiKeyId] : ['type' => 'USER', 'userId' => (string) $this->userId];
    }
}
