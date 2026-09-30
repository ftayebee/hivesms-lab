import { Decimal } from "decimal.js";
import type { WalletTxReason } from "@/generated/prisma/enums";
import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";

/**
 * Wallet ledger. Every balance change is a single atomic conditional UPDATE plus an append-only
 * wallet_transactions row inside the caller's transaction:
 *   - debits use `WHERE balance >= amount`, so concurrent sends can never overdraw the wallet;
 *   - (reason, referenceType, referenceId) is unique, so a refund, top-up or charge for the same
 *     reference can never be applied twice (webhook replays, retries).
 */
export interface LedgerEntry {
  organizationId: string;
  amount: Decimal | number | string;
  reason: WalletTxReason;
  description: string;
  referenceType?: string;
  referenceId?: string;
  createdById?: string | null;
}

export async function ensureWallet(organizationId: string, tx: Tx | typeof db = db) {
  return tx.wallet.upsert({ where: { organizationId }, create: { organizationId }, update: {} });
}

export async function debitWallet(tx: Tx, entry: LedgerEntry) {
  const amount = new Decimal(entry.amount.toString());
  if (amount.lte(0)) throw new Error("Debit amount must be positive");
  const rows = await tx.$queryRaw<{ id: string; balance: string }[]>`
    UPDATE wallets SET balance = balance - ${amount.toString()}::numeric, "updatedAt" = now()
    WHERE "organizationId" = ${entry.organizationId}::uuid AND balance >= ${amount.toString()}::numeric
    RETURNING id, balance::text`;
  if (!rows.length) {
    throw new AppError("INSUFFICIENT_BALANCE", "Insufficient balance. Add balance to your wallet and try again.", {
      required: amount.toFixed(2),
    });
  }
  return tx.walletTransaction.create({
    data: {
      walletId: rows[0].id,
      organizationId: entry.organizationId,
      type: "DEBIT",
      reason: entry.reason,
      amount: amount.toString(),
      balanceAfter: rows[0].balance,
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      createdById: entry.createdById ?? null,
    },
  });
}

export async function creditWallet(tx: Tx, entry: LedgerEntry) {
  const amount = new Decimal(entry.amount.toString());
  if (amount.lte(0)) throw new Error("Credit amount must be positive");
  await ensureWallet(entry.organizationId, tx);
  const rows = await tx.$queryRaw<{ id: string; balance: string }[]>`
    UPDATE wallets SET balance = balance + ${amount.toString()}::numeric, "updatedAt" = now(),
      "lowBalanceNotifiedAt" = CASE WHEN balance + ${amount.toString()}::numeric > "lowBalanceThreshold" THEN NULL ELSE "lowBalanceNotifiedAt" END
    WHERE "organizationId" = ${entry.organizationId}::uuid
    RETURNING id, balance::text`;
  return tx.walletTransaction.create({
    data: {
      walletId: rows[0].id,
      organizationId: entry.organizationId,
      type: "CREDIT",
      reason: entry.reason,
      amount: amount.toString(),
      balanceAfter: rows[0].balance,
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      createdById: entry.createdById ?? null,
    },
  });
}

export async function getBalance(organizationId: string): Promise<Decimal> {
  const w = await db.wallet.findUnique({ where: { organizationId }, select: { balance: true } });
  return new Decimal(w?.balance?.toString() ?? "0");
}
