<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Table `credit_packages`. */
class CreditPackage extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'credit_packages';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [
        'name',
        'amount',
        'bonusPercent',
        'description',
        'active',
        'sortOrder',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'bonusPercent' => '0',
        'active' => true,
        'sortOrder' => 0,
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:4',
            'bonusPercent' => 'decimal:2',
            'active' => 'boolean',
            'sortOrder' => 'integer',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class, 'packageId');
    }
}
