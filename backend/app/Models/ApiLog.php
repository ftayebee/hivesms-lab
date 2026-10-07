<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `api_logs`. */
class ApiLog extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'api_logs';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'organizationId',
        'apiKeyId',
        'requestId',
        'method',
        'path',
        'statusCode',
        'durationMs',
        'errorCode',
        'ipAddress',
        'userAgent',
    ];

    protected function casts(): array
    {
        return [
            'statusCode' => 'integer',
            'durationMs' => 'integer',
            'createdAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function apiKey(): BelongsTo
    {
        return $this->belongsTo(ApiKey::class, 'apiKeyId');
    }
}
