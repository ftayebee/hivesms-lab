<?php

namespace App\Services\ApiKey;

use App\Auth\TenantContext;
use App\Exceptions\AppException;
use App\Models\ApiKey;
use App\Models\ApiLog;
use App\Services\Platform\AuditLogger;
use App\Services\Platform\NotificationService;
use App\Support\Crypto;
use App\Support\ErrorCode;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Collection;
use RuntimeException;

/**
 * Customer API keys (port of lib/api/api-keys.ts + features/developers/service.ts).
 *
 * Format: sfk_live_<8-char id>_<43-char secret>. Only HMAC-SHA256(API_KEY_PEPPER, full key) is
 * stored — the existing scheme, so every key issued by the Node app keeps working unchanged (no
 * migration needed: keys were never stored in plain text). The full key is shown exactly once.
 */
class ApiKeyService
{
    public const PREFIX = 'sfk_live_';

    private const MAX_ACTIVE = 25;

    public function __construct(private readonly AuditLogger $audit, private readonly NotificationService $notifications) {}

    public static function hash(string $fullKey): string
    {
        $pepper = (string) config('smsflow.api_key_pepper');
        if ($pepper === '') {
            throw new RuntimeException('API_KEY_PEPPER is not set');
        }

        return Crypto::hmacSha256($pepper, $fullKey);
    }

    /** @return array{prefix: string, fullKey: string, keyHash: string} */
    public static function generate(): array
    {
        $prefix = self::PREFIX.Crypto::randomAlphanumeric(8);
        $fullKey = $prefix.'_'.Crypto::randomToken(32);

        return ['prefix' => $prefix, 'fullKey' => $fullKey, 'keyHash' => self::hash($fullKey)];
    }

    /** @return Collection<int, ApiKey> */
    public function list(TenantContext $ctx): Collection
    {
        $ctx->requirePermission('api_keys:read');

        return ApiKey::query()->where('organizationId', $ctx->organizationId)->orderBy('status')->orderByDesc('createdAt')->get();
    }

    /**
     * @param  array{name: string, scopes: list<string>, ipAllowlist: list<string>, expiresInDays: ?int}  $input
     * @return array{key: ApiKey, fullKey: string}
     */
    public function create(TenantContext $ctx, array $input): array
    {
        $ctx->requirePermission('api_keys:manage');
        if (ApiKey::query()->where('organizationId', $ctx->organizationId)->where('status', 'ACTIVE')->count() >= self::MAX_ACTIVE) {
            throw new AppException(ErrorCode::VALIDATION_ERROR, 'You can have at most 25 active keys. Revoke unused keys first.');
        }
        ['prefix' => $prefix, 'fullKey' => $fullKey, 'keyHash' => $keyHash] = self::generate();
        $key = ApiKey::query()->forceCreate([
            'organizationId' => $ctx->organizationId, 'name' => $input['name'], 'prefix' => $prefix, 'keyHash' => $keyHash,
            'scopes' => array_values($input['scopes']), 'ipAllowlist' => array_values($input['ipAllowlist']),
            'expiresAt' => $input['expiresInDays'] ? now()->addDays($input['expiresInDays']) : null, 'createdById' => $ctx->userId,
        ]);
        $this->audit->log('api_key.create', $ctx->actor(), $ctx->organizationId, 'api_key', $key->id, ['name' => $key->name, 'prefix' => $prefix, 'scopes' => $input['scopes']], $ctx->ip);
        $this->notifications->notify($ctx->organizationId, 'api_key.created', "API key \"{$key->name}\" created", "Key {$prefix}… was created. If this wasn't expected, revoke it immediately.", '/dashboard/api');

        return ['key' => $key, 'fullKey' => $fullKey];
    }

    public function revoke(TenantContext $ctx, string $id): void
    {
        $ctx->requirePermission('api_keys:manage');
        $k = ApiKey::query()->where('organizationId', $ctx->organizationId)->whereKey($id)->first()
            ?? throw new AppException(ErrorCode::NOT_FOUND, 'API key not found.');
        if ($k->status->value === 'REVOKED') {
            return;
        }
        $k->forceFill(['status' => 'REVOKED', 'revokedAt' => now(), 'revokedById' => $ctx->userId])->save();
        $this->audit->log('api_key.revoke', $ctx->actor(), $ctx->organizationId, 'api_key', $id, ['prefix' => $k->prefix], $ctx->ip);
        $this->notifications->notify($ctx->organizationId, 'api_key.created', "API key \"{$k->name}\" revoked", "Requests using {$k->prefix}… are now rejected.", '/dashboard/api');
    }

    /** @return array{page: LengthAwarePaginator, stats: array{total: int, ok: int, clientErrors: int, serverErrors: int}} */
    public function logs(TenantContext $ctx, int $page, ?string $status, ?string $keyId): array
    {
        $ctx->requirePermission('api_keys:read');
        $q = ApiLog::query()->where('organizationId', $ctx->organizationId)
            ->when($keyId, fn ($w) => $w->where('apiKeyId', $keyId))
            ->when($status === '2xx', fn ($w) => $w->whereBetween('statusCode', [200, 299]))
            ->when($status === '4xx', fn ($w) => $w->whereBetween('statusCode', [400, 499]))
            ->when($status === '5xx', fn ($w) => $w->where('statusCode', '>=', 500));
        $last24 = ApiLog::query()->where('organizationId', $ctx->organizationId)->where('createdAt', '>=', now()->subDay()->format('Y-m-d H:i:s.v'))
            ->groupBy('statusCode')->selectRaw('statusCode, COUNT(*) AS n')->pluck('n', 'statusCode');
        $sum = fn (callable $f) => (int) $last24->filter(fn ($n, $code) => $f((int) $code))->sum();

        return [
            'page' => $q->with('apiKey:id,name,prefix')->orderByDesc('createdAt')->paginate(30, ['*'], 'page', $page),
            'stats' => ['total' => $sum(fn () => true), 'ok' => $sum(fn ($s) => $s < 400), 'clientErrors' => $sum(fn ($s) => $s >= 400 && $s < 500), 'serverErrors' => $sum(fn ($s) => $s >= 500)],
        ];
    }
}
