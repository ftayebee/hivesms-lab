<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `notifications`. */
class Notification extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'notifications';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'organizationId',
        'userId',
        'type',
        'title',
        'body',
        'link',
        'readAt',
    ];

    protected function casts(): array
    {
        return [
            'readAt' => 'datetime',
            'createdAt' => 'datetime',
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
}
