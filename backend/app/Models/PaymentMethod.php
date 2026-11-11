<?php

namespace App\Models;

use App\Enums\PaymentMethodType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\SoftDeletes;

/** Table `payment_methods`: manual receiving accounts configured by the Super Admin (docs/22). */
class PaymentMethod extends BaseModel
{
    use HasUuids;
    use SoftDeletes;

    protected $table = 'payment_methods';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    const DELETED_AT = 'deletedAt';

    protected $fillable = [];

    protected $attributes = [
        'requireProof' => false,
        'requireSenderNumber' => true,
        'active' => true,
        'sortOrder' => 0,
    ];

    protected function casts(): array
    {
        return [
            'type' => PaymentMethodType::class,
            'qrImage' => 'array',
            'minAmount' => 'decimal:4',
            'maxAmount' => 'decimal:4',
            'requireProof' => 'boolean',
            'requireSenderNumber' => 'boolean',
            'active' => 'boolean',
            'sortOrder' => 'integer',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
            'deletedAt' => 'datetime',
        ];
    }
}
