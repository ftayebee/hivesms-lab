<?php

namespace App\Models;

use App\Enums\MessageSource;
use App\Enums\MessageStatus;
use App\Enums\SenderType;
use App\Enums\SmsEncoding;
use App\Enums\SmsType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** One SMS. Also the send queue (status QUEUED + nextAttemptAt, leased via lockedUntil). */
class Message extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'messages';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'campaignId',
        'apiKeyId',
        'source',
        'to',
        'operator',
        'senderValue',
        'senderType',
        'smsType',
        'body',
        'encoding',
        'segments',
        'provider',
        'providerMessageId',
        'errorCode',
        'errorMessage',
        'clientReference',
        'attempts',
        'nextAttemptAt',
        'lockedUntil',
        'queuedAt',
        'submittedAt',
        'deliveredAt',
        'failedAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'QUEUED',
        'attempts' => 0,
    ];

    protected function casts(): array
    {
        return [
            'source' => MessageSource::class,
            'senderType' => SenderType::class,
            'smsType' => SmsType::class,
            'encoding' => SmsEncoding::class,
            'segments' => 'integer',
            'unitPrice' => 'decimal:4',
            'cost' => 'decimal:4',
            'status' => MessageStatus::class,
            'attempts' => 'integer',
            'nextAttemptAt' => 'datetime',
            'lockedUntil' => 'datetime',
            'queuedAt' => 'datetime',
            'submittedAt' => 'datetime',
            'deliveredAt' => 'datetime',
            'failedAt' => 'datetime',
            'refundedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class, 'campaignId');
    }

    public function apiKey(): BelongsTo
    {
        return $this->belongsTo(ApiKey::class, 'apiKeyId');
    }

    public function events(): HasMany
    {
        return $this->hasMany(MessageEvent::class, 'messageId');
    }
}
