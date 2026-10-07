<?php

namespace App\Models;

use App\Enums\CampaignStatus;
use App\Enums\SenderType;
use App\Enums\SmsEncoding;
use App\Enums\SmsType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Table `campaigns`. */
class Campaign extends BaseModel
{
    use HasFactory;
    use HasUuids;
    use SoftDeletes;

    protected $table = 'campaigns';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    const DELETED_AT = 'deletedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'name',
        'smsType',
        'senderIdId',
        'senderValue',
        'senderType',
        'templateId',
        'message',
        'encoding',
        'segmentsPerMessage',
        'audience',
        'scheduledAt',
        'createdById',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'DRAFT',
        'audience' => '{}',
        'recipientCount' => 0,
        'skippedCount' => 0,
        'queuedCount' => 0,
        'submittedCount' => 0,
        'deliveredCount' => 0,
        'failedCount' => 0,
        'estimatedCost' => '0',
        'actualCost' => '0',
        'refundedAmount' => '0',
    ];

    protected function casts(): array
    {
        return [
            'smsType' => SmsType::class,
            'senderType' => SenderType::class,
            'encoding' => SmsEncoding::class,
            'segmentsPerMessage' => 'integer',
            'status' => CampaignStatus::class,
            'audience' => 'array',
            'scheduledAt' => 'datetime',
            'startedAt' => 'datetime',
            'completedAt' => 'datetime',
            'pausedAt' => 'datetime',
            'cancelledAt' => 'datetime',
            'recipientCount' => 'integer',
            'skippedCount' => 'integer',
            'queuedCount' => 'integer',
            'submittedCount' => 'integer',
            'deliveredCount' => 'integer',
            'failedCount' => 'integer',
            'estimatedCost' => 'decimal:4',
            'actualCost' => 'decimal:4',
            'refundedAmount' => 'decimal:4',
            'reviewedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
            'deletedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function senderId(): BelongsTo
    {
        return $this->belongsTo(SenderId::class, 'senderIdId');
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(Template::class, 'templateId');
    }

    public function recipients(): HasMany
    {
        return $this->hasMany(CampaignRecipient::class, 'campaignId');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class, 'campaignId');
    }
}
