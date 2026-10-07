<?php

namespace App\Models;

use App\Enums\SenderIdStatus;
use App\Enums\SenderType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Table `sender_ids`. */
class SenderId extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'sender_ids';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'value',
        'type',
        'purpose',
        'sampleMessage',
        'documents',
        'isDefault',
        'submittedById',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'PENDING',
        'documents' => '[]',
        'isDefault' => false,
    ];

    protected function casts(): array
    {
        return [
            'type' => SenderType::class,
            'status' => SenderIdStatus::class,
            'documents' => 'array',
            'isDefault' => 'boolean',
            'reviewedAt' => 'datetime',
            'approvedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function campaigns(): HasMany
    {
        return $this->hasMany(Campaign::class, 'senderIdId');
    }
}
