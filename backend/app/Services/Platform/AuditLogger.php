<?php

namespace App\Services\Platform;

use App\Models\AuditLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Audit log (port of src/lib/audit.ts). Inside a transaction the write must succeed (the change
 * must not commit unaudited); outside one, failures are logged and swallowed. Never put secrets or
 * full message bodies into metadata.
 */
class AuditLogger
{
    /**
     * @param  array{type: string, userId?: string|null, apiKeyId?: string|null}  $actor
     * @param  array<string, mixed>  $metadata
     */
    public function log(
        string $action,
        array $actor,
        ?string $organizationId = null,
        ?string $targetType = null,
        ?string $targetId = null,
        array $metadata = [],
        ?string $ip = null,
        ?string $userAgent = null,
    ): void {
        $data = [
            'action' => $action,
            'actorType' => $actor['type'],
            'actorUserId' => in_array($actor['type'], ['USER', 'ADMIN'], true) ? ($actor['userId'] ?? null) : null,
            'actorApiKeyId' => $actor['type'] === 'API_KEY' ? ($actor['apiKeyId'] ?? null) : null,
            'organizationId' => $organizationId,
            'targetType' => $targetType,
            'targetId' => $targetId,
            'ipAddress' => $ip,
            'userAgent' => $userAgent !== null ? mb_substr($userAgent, 0, 500) : null,
            'metadata' => $metadata,
        ];
        $inTransaction = DB::transactionLevel() > 0;
        try {
            AuditLog::query()->forceCreate($data);
        } catch (Throwable $e) {
            if ($inTransaction) {
                throw $e;
            }
            Log::error('failed to write audit log', ['action' => $action, 'error' => $e->getMessage()]);
        }
        Log::info('audit', ['audit' => $action, 'actor' => $actor['type'], 'org' => $organizationId, 'target' => $targetId]);
    }
}
