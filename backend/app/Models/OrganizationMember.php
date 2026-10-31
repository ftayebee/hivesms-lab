<?php

namespace App\Models;

use App\Enums\MemberStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `organization_members`. */
class OrganizationMember extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'organization_members';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'userId',
        'roleId',
        'invitedById',
        'joinedAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'status' => 'ACTIVE',
    ];

    protected function casts(): array
    {
        return [
            'status' => MemberStatus::class,
            'joinedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'userId');
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class, 'roleId');
    }
}
