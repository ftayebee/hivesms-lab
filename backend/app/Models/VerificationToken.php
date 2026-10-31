<?php

namespace App\Models;

use App\Enums\VerificationTokenType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `verification_tokens`. */
class VerificationToken extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'verification_tokens';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'userId',
        'type',
        'target',
        'expiresAt',
    ];

    protected $hidden = [
        'tokenHash',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'attempts' => 0,
    ];

    protected function casts(): array
    {
        return [
            'type' => VerificationTokenType::class,
            'attempts' => 'integer',
            'expiresAt' => 'datetime',
            'consumedAt' => 'datetime',
            'createdAt' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'userId');
    }
}
