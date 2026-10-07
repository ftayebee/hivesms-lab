<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Login session. Only sha256(token) is stored; the token lives in the user's cookie. */
class Session extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'sessions';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'activeOrganizationId',
        'ipAddress',
        'userAgent',
        'lastSeenAt',
    ];

    protected $hidden = [
        'tokenHash',
    ];

    protected function casts(): array
    {
        return [
            'expiresAt' => 'datetime',
            'lastSeenAt' => 'datetime',
            'createdAt' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'userId');
    }
}
