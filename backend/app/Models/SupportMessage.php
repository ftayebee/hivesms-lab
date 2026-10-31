<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `support_messages`. */
class SupportMessage extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'support_messages';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'ticketId',
        'authorId',
        'body',
        'isInternal',
        'attachments',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'isStaff' => false,
        'isInternal' => false,
        'attachments' => '[]',
    ];

    protected function casts(): array
    {
        return [
            'isStaff' => 'boolean',
            'isInternal' => 'boolean',
            'attachments' => 'array',
            'createdAt' => 'datetime',
        ];
    }

    public function ticket(): BelongsTo
    {
        return $this->belongsTo(SupportTicket::class, 'ticketId');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'authorId');
    }
}
