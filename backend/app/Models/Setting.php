<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;

/** Platform setting (string key). Secret values are AES-256-GCM encrypted with SETTINGS_ENCRYPTION_KEY. */
class Setting extends BaseModel
{
    use HasFactory;

    protected $table = 'settings';

    protected $primaryKey = 'key';

    protected $keyType = 'string';

    public $incrementing = false;

    const CREATED_AT = null;

    const UPDATED_AT = 'updatedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'key',
        'updatedById',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'isSecret' => false,
    ];

    protected function casts(): array
    {
        return [
            'value' => 'array',
            'isSecret' => 'boolean',
            'updatedAt' => 'datetime',
        ];
    }
}
