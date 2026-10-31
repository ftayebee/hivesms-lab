<?php

namespace App\Models;

use App\Enums\MessageEventSource;
use App\Enums\MessageStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `message_events`. */
class MessageEvent extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'message_events';

    public $timestamps = false;

    protected $fillable = [
        'messageId',
        'status',
        'providerStatus',
        'description',
        'source',
        'dedupeKey',
        'payload',
        'occurredAt',
        'receivedAt',
    ];

    protected function casts(): array
    {
        return [
            'status' => MessageStatus::class,
            'source' => MessageEventSource::class,
            'payload' => 'array',
            'occurredAt' => 'datetime',
            'receivedAt' => 'datetime',
        ];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class, 'messageId');
    }
}
