<?php

namespace App\Models;

use App\Enums\WalletTxReason;
use App\Enums\WalletTxType;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Immutable ledger entry. amount is always positive; type gives the direction. */
class WalletTransaction extends BaseModel
{
    use HasFactory;
    use HasUuids;

    protected $table = 'wallet_transactions';

    const CREATED_AT = 'createdAt';

    const UPDATED_AT = null;

    /** Privileged columns are deliberately absent: services set them with forceFill(). */
    protected $fillable = [
        'walletId',
        'organizationId',
        'description',
        'referenceType',
        'referenceId',
        'createdById',
    ];

    protected function casts(): array
    {
        return [
            'type' => WalletTxType::class,
            'reason' => WalletTxReason::class,
            'amount' => 'decimal:4',
            'balanceAfter' => 'decimal:4',
            'createdAt' => 'datetime',
        ];
    }

    public function wallet(): BelongsTo
    {
        return $this->belongsTo(Wallet::class, 'walletId');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'organizationId');
    }
}
