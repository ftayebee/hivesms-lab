<?php

namespace App\Models;

use App\Enums\RecipientStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `campaign_recipients`. */
class CampaignRecipient extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'campaign_recipients';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'campaignId',
        'contactId',
        'phone',
        'variables',
        'status',
        'messageId',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'INCLUDED',
    ];

    protected function casts(): array
    {
        return [
            'variables' => 'array',
            'status' => RecipientStatus::class,
            'createdAt' => 'datetime',
        ];
    }

    public function campaign(): BelongsTo
    {
        return $this->belongsTo(Campaign::class, 'campaignId');
    }
}
