<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;

/** Named gap-free counter (e.g. invoice_number). Increment only inside a transaction. */
class Counter extends BaseModel
{
    use HasFactory;

    protected $table = 'counters';

    protected $primaryKey = 'name';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'name',
    ];

    protected function casts(): array
    {
        return [
            'value' => 'integer',
        ];
    }
}
