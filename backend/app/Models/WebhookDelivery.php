<?php

namespace App\Models;

use App\Enums\WebhookDeliveryStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `webhook_deliveries`. */
class WebhookDelivery extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'webhook_deliveries';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [
        'endpointId',
        'event',
        'payload',
        'status',
        'attempts',
        'responseStatus',
        'responseBody',
        'nextAttemptAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'PENDING',
        'attempts' => 0,
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'status' => WebhookDeliveryStatus::class,
            'attempts' => 'integer',
            'responseStatus' => 'integer',
            'nextAttemptAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function endpoint(): BelongsTo
    {
        return $this->belongsTo(WebhookEndpoint::class, 'endpointId');
    }
}
