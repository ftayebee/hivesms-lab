<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `idempotency_keys`. */
class IdempotencyKey extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'idempotency_keys';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'organizationId',
        'key',
        'requestHash',
        'statusCode',
        'response',
        'expiresAt',
    ];

    protected $hidden = [
        'requestHash',
    ];

    protected function casts(): array
    {
        return [
            'statusCode' => 'integer',
            'response' => 'array',
            'createdAt' => 'datetime',
            'expiresAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }
}
