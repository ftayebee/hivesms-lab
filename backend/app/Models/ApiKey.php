<?php

namespace App\Models;

use App\Enums\ApiKeyStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Customer API key. keyHash = HMAC-SHA256(API_KEY_PEPPER, full key); the key itself is never stored. */
class ApiKey extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'api_keys';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'name',
        'prefix',
        'scopes',
        'ipAllowlist',
        'expiresAt',
        'createdById',
    ];

    protected $hidden = [
        'keyHash',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'ipAllowlist' => '[]',
        'status' => 'ACTIVE',
    ];

    protected function casts(): array
    {
        return [
            'scopes' => 'array',
            'ipAllowlist' => 'array',
            'status' => ApiKeyStatus::class,
            'lastUsedAt' => 'datetime',
            'expiresAt' => 'datetime',
            'revokedAt' => 'datetime',
            'createdAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class, 'apiKeyId');
    }

    public function apiLogs(): HasMany
    {
        return $this->hasMany(ApiLog::class, 'apiKeyId');
    }
}
