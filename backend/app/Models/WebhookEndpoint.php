<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Table `webhooks`. */
class WebhookEndpoint extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'webhooks';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'url',
        'description',
        'events',
        'active',
        'lastDeliveryAt',
        'lastStatusCode',
    ];

    protected $hidden = [
        'secretEncrypted',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'active' => true,
        'failureCount' => 0,
    ];

    protected function casts(): array
    {
        return [
            'events' => 'array',
            'active' => 'boolean',
            'failureCount' => 'integer',
            'lastDeliveryAt' => 'datetime',
            'lastStatusCode' => 'integer',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(WebhookDelivery::class, 'endpointId');
    }
}
