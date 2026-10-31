<?php

namespace App\Models;

use App\Enums\PlatformRole;
use App\Enums\UserStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Person who signs in (dashboard or admin). Password: argon2id hash in passwordHash. */
class User extends BaseModel
{
    use HasFactory;
    use HasUuids;
    use SoftDeletes;

    protected $table = 'users';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    const DELETED_AT = 'deletedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'email',
        'phone',
        'name',
        'locale',
    ];

    protected $hidden = [
        'passwordHash',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'platformRole' => 'USER',
        'status' => 'ACTIVE',
        'locale' => 'en',
        'failedLoginCount' => 0,
    ];

    protected function casts(): array
    {
        return [
            'platformRole' => PlatformRole::class,
            'status' => UserStatus::class,
            'emailVerifiedAt' => 'datetime',
            'phoneVerifiedAt' => 'datetime',
            'failedLoginCount' => 'integer',
            'lockedUntil' => 'datetime',
            'lastLoginAt' => 'datetime',
            'passwordChangedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
            'deletedAt' => 'datetime',
        ];
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(Session::class, 'userId');
    }

    public function verificationTokens(): HasMany
    {
        return $this->hasMany(VerificationToken::class, 'userId');
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(OrganizationMember::class, 'userId');
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class, 'userId');
    }

    public function notificationPrefs(): HasMany
    {
        return $this->hasMany(NotificationPreference::class, 'userId');
    }

    public function ticketMessages(): HasMany
    {
        return $this->hasMany(SupportMessage::class, 'authorId');
    }

    public function createdTickets(): HasMany
    {
        return $this->hasMany(SupportTicket::class, 'createdById');
    }

    public function assignedTickets(): HasMany
    {
        return $this->hasMany(SupportTicket::class, 'assignedToId');
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(AuditLog::class, 'actorUserId');
    }
}
