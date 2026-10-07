<?php

namespace App\Models;

use App\Enums\BlocklistType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/** Table `blocklist_entries`. */
class BlocklistEntry extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'blocklist_entries';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'type',
        'value',
        'reason',
        'createdById',
    ];

    protected function casts(): array
    {
        return [
            'type' => BlocklistType::class,
            'createdAt' => 'datetime',
        ];
    }
}
