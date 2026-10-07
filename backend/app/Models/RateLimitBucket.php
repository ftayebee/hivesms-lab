<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;

/** Fixed-window rate limit counter (composite key key + windowStart). Use the query builder. */
class RateLimitBucket extends BaseModel
{
    use HasFactory;

    protected $table = 'rate_limit_buckets';

    /** Composite primary key: not addressable through Eloquent's find(); query by columns. */
    protected $primaryKey = null;

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = [
        'key',
        'windowStart',
        'count',
        'expiresAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'count' => 0,
    ];

    protected function casts(): array
    {
        return [
            'windowStart' => 'datetime',
            'count' => 'integer',
            'expiresAt' => 'datetime',
        ];
    }
}
