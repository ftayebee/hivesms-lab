<?php

namespace App\Models;

use App\Enums\PaymentStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/** Table `payments`. */
class Payment extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'payments';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'provider',
        'packageId',
        'amount',
        'vatRate',
        'vatAmount',
        'total',
        'currency',
        'method',
        'manualReference',
        'metadata',
        'initiatedById',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'vatRate' => '0',
        'vatAmount' => '0',
        'currency' => 'BDT',
        'status' => 'PENDING',
        'metadata' => '{}',
    ];

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:4',
            'vatRate' => 'decimal:2',
            'vatAmount' => 'decimal:4',
            'total' => 'decimal:4',
            'creditAmount' => 'decimal:4',
            'status' => PaymentStatus::class,
            'metadata' => 'array',
            'completedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function package(): BelongsTo
    {
        return $this->belongsTo(CreditPackage::class, 'packageId');
    }

    public function invoice(): HasOne
    {
        return $this->hasOne(Invoice::class, 'paymentId');
    }
}
