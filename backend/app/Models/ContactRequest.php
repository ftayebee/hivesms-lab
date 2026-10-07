<?php

namespace App\Models;

use App\Enums\LeadStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/** Table `contact_requests`. */
class ContactRequest extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'contact_requests';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'name',
        'company',
        'email',
        'phone',
        'subject',
        'message',
        'status',
        'ipAddress',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'NEW',
    ];

    protected function casts(): array
    {
        return [
            'status' => LeadStatus::class,
            'createdAt' => 'datetime',
        ];
    }
}
