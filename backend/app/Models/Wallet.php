<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Prepaid BDT balance. Change balance only through the wallet service (row lock + ledger entry). */
class Wallet extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'wallets';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = 'updatedAt';

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'organizationId',
        'currency',
        'lowBalanceThreshold',
    ];

    /** Application-side defaults (as the Prisma client applied them). */
    protected $attributes = [
        'balance' => '0',
        'currency' => 'BDT',
        'lowBalanceThreshold' => '100',
    ];

    protected function casts(): array
    {
        return [
            'balance' => 'decimal:4',
            'lowBalanceThreshold' => 'decimal:4',
            'lowBalanceNotifiedAt' => 'datetime',
            'createdAt' => 'datetime',
            'updatedAt' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(WalletTransaction::class, 'walletId');
    }
}
