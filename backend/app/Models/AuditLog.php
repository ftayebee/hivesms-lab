<?php

namespace App\Models;

use App\Enums\ActorType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `audit_logs`. */
class AuditLog extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'audit_logs';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'organizationId',
        'actorType',
        'actorUserId',
        'actorApiKeyId',
        'action',
        'targetType',
        'targetId',
        'ipAddress',
        'userAgent',
        'metadata',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'metadata' => '{}',
    ];

    protected function casts(): array
    {
        return [
            'actorType' => ActorType::class,
            'metadata' => 'array',
            'createdAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actorUserId');
    }
}
