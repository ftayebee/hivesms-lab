<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `invitations`. */
class Invitation extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'invitations';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'email',
        'roleId',
        'invitedById',
        'expiresAt',
    ];

    protected $hidden = [
        'tokenHash',
    ];

    protected function casts(): array
    {
        return [
            'expiresAt' => 'datetime',
            'acceptedAt' => 'datetime',
            'revokedAt' => 'datetime',
            'createdAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function role(): BelongsTo
    {
        return $this->belongsTo(Role::class, 'roleId');
    }
}
