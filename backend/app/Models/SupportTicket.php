<?php

namespace App\Models;

use App\Enums\TicketPriority;
use App\Enums\TicketStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Table `support_tickets`. */
class SupportTicket extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'support_tickets';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [
        'organizationId',
        'subject',
        'category',
        'priority',
        'status',
        'createdById',
        'assignedToId',
        'lastReplyAt',
        'closedAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'priority' => 'NORMAL',
        'status' => 'OPEN',
    ];

    protected function casts(): array
    {
        return [
            'number' => 'integer',
            'priority' => TicketPriority::class,
            'status' => TicketStatus::class,
            'lastReplyAt' => 'datetime',
            'closedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'createdById');
    }

    public function assignedTo(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignedToId');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(SupportMessage::class, 'ticketId');
    }
}
