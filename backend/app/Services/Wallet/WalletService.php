<?php

namespace App\Services\Wallet;

use App\Exceptions\AppException;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use App\Support\ErrorCode;
use App\Support\Money;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use LogicException;

/**
 * Wallet ledger (port of src/services/billing/wallet.ts). Every balance change is one atomic
 * conditional UPDATE plus an append-only wallet_transactions row, inside the caller's transaction:
 *  - debits use `WHERE balance >= amount`, so concurrent sends can never overdraw the wallet
 *    (the CHECK balance >= 0 constraint is the last line of defence);
 *  - (reason, referenceType, referenceId) is unique, so a refund, top-up or charge for the same
 *    reference can never be applied twice (webhook replays, retries) — the duplicate insert fails
 *    and rolls the whole transaction back.
 */
class WalletService
{
    public function ensureWallet(string $organizationId): void
    {
        DB::statement(
            'INSERT INTO wallets (id, organizationId, balance, currency, lowBalanceThreshold, createdAt, updatedAt) VALUES (UUID(), ?, 0, \'BDT\', 100, ?, ?) ON DUPLICATE KEY UPDATE id = id',
            [$organizationId, $now = now()->format('Y-m-d H:i:s.v'), $now],
        );
    }

    /** Row lock on the wallet: serialises balance and sending-limit checks per organization. */
    public function lock(string $organizationId): void
    {
        $this->assertInTransaction();
        DB::select('SELECT id FROM wallets WHERE organizationId = ? FOR UPDATE', [$organizationId]);
    }

    /**
     * @param  array{organizationId: string, amount: string, reason: string, description: string, referenceType?: string|null, referenceId?: string|null, createdById?: string|null}  $entry
     */
    public function debit(array $entry): WalletTransaction
    {
        $this->assertInTransaction();
        $amount = Money::round($entry['amount'], 4);
        if (! Money::isPositive($amount)) {
            throw new InvalidArgumentException('Debit amount must be positive');
        }
        $changed = DB::update(
            'UPDATE wallets SET balance = balance - CAST(? AS DECIMAL(14,4)), updatedAt = ? WHERE organizationId = ? AND balance >= CAST(? AS DECIMAL(14,4))',
            [$amount, now()->format('Y-m-d H:i:s.v'), $entry['organizationId'], $amount],
        );
        if (! $changed) {
            throw new AppException(ErrorCode::INSUFFICIENT_BALANCE, 'Insufficient balance. Add balance to your wallet and try again.', [
                'required' => Money::round($amount, 2),
            ]);
        }

        return $this->ledger('DEBIT', $amount, $entry);
    }

    /** @param array{organizationId: string, amount: string, reason: string, description: string, referenceType?: string|null, referenceId?: string|null, createdById?: string|null} $entry */
    public function credit(array $entry): WalletTransaction
    {
        $this->assertInTransaction();
        $amount = Money::round($entry['amount'], 4);
        if (! Money::isPositive($amount)) {
            throw new InvalidArgumentException('Credit amount must be positive');
        }
        $this->ensureWallet($entry['organizationId']);
        // MySQL applies SET assignments left to right: the low-balance flag is evaluated before balance changes.
        DB::update(
            'UPDATE wallets SET
                lowBalanceNotifiedAt = CASE WHEN balance + CAST(? AS DECIMAL(14,4)) > lowBalanceThreshold THEN NULL ELSE lowBalanceNotifiedAt END,
                balance = balance + CAST(? AS DECIMAL(14,4)), updatedAt = ?
             WHERE organizationId = ?',
            [$amount, $amount, now()->format('Y-m-d H:i:s.v'), $entry['organizationId']],
        );

        return $this->ledger('CREDIT', $amount, $entry);
    }

    private function ledger(string $type, string $amount, array $entry): WalletTransaction
    {
        // Balance right after our UPDATE; the row stays locked by it until the transaction ends.
        $row = DB::selectOne('SELECT id, CAST(balance AS CHAR) AS balance FROM wallets WHERE organizationId = ?', [$entry['organizationId']]);

        return WalletTransaction::query()->forceCreate([
            'walletId' => $row->id,
            'organizationId' => $entry['organizationId'],
            'type' => $type,
            'reason' => $entry['reason'],
            'amount' => $amount,
            'balanceAfter' => $row->balance,
            'description' => $entry['description'],
            'referenceType' => $entry['referenceType'] ?? null,
            'referenceId' => $entry['referenceId'] ?? null,
            'createdById' => $entry['createdById'] ?? null,
        ]);
    }

    public function balance(string $organizationId): string
    {
        $b = DB::scalar('SELECT CAST(balance AS CHAR) FROM wallets WHERE organizationId = ?', [$organizationId]);

        return $b !== null ? (string) $b : '0';
    }

    public function wallet(string $organizationId): ?Wallet
    {
        return Wallet::query()->where('organizationId', $organizationId)->first();
    }

    private function assertInTransaction(): void
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('Wallet changes must run inside a database transaction.');
        }
    }
}
