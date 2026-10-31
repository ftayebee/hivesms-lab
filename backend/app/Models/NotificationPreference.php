<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `notification_preferences`. */
class NotificationPreference extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'notification_preferences';

    public $timestamps = false;

    protected $fillable = [
        'userId',
        'type',
        'inApp',
        'email',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'inApp' => true,
        'email' => true,
    ];

    protected function casts(): array
    {
        return [
            'inApp' => 'boolean',
            'email' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'userId');
    }
}
