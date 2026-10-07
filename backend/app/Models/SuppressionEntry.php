<?php

namespace App\Models;

use App\Enums\SuppressionReason;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `suppression_entries`. */
class SuppressionEntry extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'suppression_entries';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    protected $fillable = [
        'organizationId',
        'phone',
        'reason',
        'source',
        'note',
    ];

    protected function casts(): array
    {
        return [
            'reason' => SuppressionReason::class,
            'createdAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }
}
