<?php

namespace App\Services\ApiKey;

use App\Auth\TenantContext;
use App\Models\ApiKey;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Authenticates `Authorization: Bearer sfk_live_…` (port of authenticateApiKey). Returns the tenant
 * context or an error key: missing | invalid | revoked | expired | ip_not_allowed | org_suspended.
 */
class ApiKeyAuthenticator
{
    /** @return array{ctx: TenantContext, apiKeyId: string, scopes: list<string>}|string */
    public function authenticate(?string $authorization, ?string $ip, ?string $userAgent = null): array|string
    {
        if (! $authorization) {
            return 'missing';
        }
        if (! preg_match('/^Bearer\s+(\S+)$/i', trim($authorization), $m)) {
            return 'invalid';
        }
        $token = $m[1];
        if (! str_starts_with($token, ApiKeyService::PREFIX) || strlen($token) > 120) {
            return 'invalid';
        }
        $key = ApiKey::query()
            ->with(['organization' => fn ($q) => $q->withTrashed()->select(['id', 'status', 'deletedAt'])])
            ->where('keyHash', ApiKeyService::hash($token))
            ->first();
        if (! $key) {
            return 'invalid';
        }
        if ($key->status->value === 'REVOKED') {
            return 'revoked';
        }
        if ($key->expiresAt && $key->expiresAt->isPast()) {
            return 'expired';
        }
        $allow = array_values(array_filter((array) $key->ipAllowlist, 'is_string'));
        if ($allow && (! $ip || ! in_array($ip, $allow, true))) {
            return 'ip_not_allowed';
        }
        if (! $key->organization || $key->organization->deletedAt !== null || $key->organization->status->value !== 'ACTIVE') {
            return 'org_suspended';
        }
        $scopes = array_values(array_filter((array) $key->scopes, 'is_string'));

        // Throttled last-used tracking (at most once a minute per key), never blocking the request.
        if (! $key->lastUsedAt || $key->lastUsedAt->lt(now()->subMinute())) {
            try {
                ApiKey::query()->whereKey($key->id)->update(['lastUsedAt' => now()->format('Y-m-d H:i:s.v'), 'lastUsedIp' => $ip]);
            } catch (Throwable $e) {
                Log::warning('api key last-used update failed', ['error' => $e->getMessage()]);
            }
        }

        return [
            'apiKeyId' => $key->id,
            'scopes' => $scopes,
            // API keys act only through scopes; sending also requires the matching org permission.
            'ctx' => new TenantContext($key->organizationId, $key->organization->status->value, null, $key->id, null, in_array('sms:send', $scopes, true) ? ['sms:send'] : [], $ip, $userAgent),
        ];
    }
}
