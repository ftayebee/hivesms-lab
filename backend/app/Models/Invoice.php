<?php

namespace App\Models;

use App\Enums\InvoiceStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Table `invoices`. */
class Invoice extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'invoices';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'paymentId',
        'subtotal',
        'vatRate',
        'vatAmount',
        'total',
        'currency',
        'billingName',
        'billingEmail',
        'billingAddress',
        'taxId',
        'lineItems',
        'issuedAt',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'currency' => 'BDT',
        'status' => 'PAID',
    ];

    protected function casts(): array
    {
        return [
            'subtotal' => 'decimal:4',
            'vatRate' => 'decimal:2',
            'vatAmount' => 'decimal:4',
            'total' => 'decimal:4',
            'status' => InvoiceStatus::class,
            'lineItems' => 'array',
            'issuedAt' => 'datetime',
            'createdAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function payment(): BelongsTo
    {
        return $this->belongsTo(Payment::class, 'paymentId');
    }
}
