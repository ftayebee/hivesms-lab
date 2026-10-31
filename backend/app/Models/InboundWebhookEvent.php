<?php

namespace App\Models;

use App\Enums\InboundWebhookStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/** Table `inbound_webhook_events`. */
class InboundWebhookEvent extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'inbound_webhook_events';

    public $timestamps = false;

    protected $fillable = [
        'provider',
        'kind',
        'eventKey',
        'signatureValid',
        'payload',
        'status',
        'error',
        'receivedAt',
        'processedAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'RECEIVED',
    ];

    protected function casts(): array
    {
        return [
            'signatureValid' => 'boolean',
            'payload' => 'array',
            'status' => InboundWebhookStatus::class,
            'receivedAt' => 'datetime',
            'processedAt' => 'datetime',
        ];
    }
}
