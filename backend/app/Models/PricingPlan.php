<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Table `pricing_plans`. */
class PricingPlan extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'pricing_plans';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    protected $fillable = [
        'key',
        'name',
        'description',
        'minRechargeAmount',
        'transactionalNonMasking',
        'transactionalMasking',
        'promotionalNonMasking',
        'promotionalMasking',
        'senderIdFee',
        'features',
        'isCustom',
        'isPublic',
        'isDefault',
        'active',
        'highlighted',
        'sortOrder',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'senderIdFee' => '0',
        'features' => '[]',
        'isCustom' => false,
        'isPublic' => true,
        'isDefault' => false,
        'active' => true,
        'highlighted' => false,
        'sortOrder' => 0,
    ];

    protected function casts(): array
    {
        return [
            'minRechargeAmount' => 'decimal:4',
            'transactionalNonMasking' => 'decimal:4',
            'transactionalMasking' => 'decimal:4',
            'promotionalNonMasking' => 'decimal:4',
            'promotionalMasking' => 'decimal:4',
            'senderIdFee' => 'decimal:4',
            'features' => 'array',
            'isCustom' => 'boolean',
            'isPublic' => 'boolean',
            'isDefault' => 'boolean',
            'active' => 'boolean',
            'highlighted' => 'boolean',
            'sortOrder' => 'integer',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organizations(): HasMany
    {
        return $this->hasMany(Organization::class, 'pricingPlanId');
    }
}
