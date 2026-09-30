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

/** Balance right after our UPDATE; the row stays locked by it until the transaction ends. */
function readWalletRow(tx: Tx, organizationId: string) {
  return tx.$queryRaw<{ id: string; balance: string }[]>`
    SELECT id, CAST(balance AS CHAR) AS balance FROM wallets WHERE organizationId = ${organizationId}`;
}

export async function debitWallet(tx: Tx, entry: LedgerEntry) {
  const amount = new Decimal(entry.amount.toString());
  if (amount.lte(0)) throw new Error("Debit amount must be positive");
  const changed = await tx.$executeRaw`
    UPDATE wallets SET balance = balance - CAST(${amount.toString()} AS DECIMAL(14,4)), updatedAt = ${new Date()}
    WHERE organizationId = ${entry.organizationId} AND balance >= CAST(${amount.toString()} AS DECIMAL(14,4))`;
  if (!changed) {
    throw new AppError("INSUFFICIENT_BALANCE", "Insufficient balance. Add balance to your wallet and try again.", {
      required: amount.toFixed(2),
    });
  }
  const rows = await readWalletRow(tx, entry.organizationId);
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
  // MySQL applies SET assignments left to right, so the flag is computed before balance changes.
  await tx.$executeRaw`
    UPDATE wallets SET
      lowBalanceNotifiedAt = CASE WHEN balance + CAST(${amount.toString()} AS DECIMAL(14,4)) > lowBalanceThreshold THEN NULL ELSE lowBalanceNotifiedAt END,
      balance = balance + CAST(${amount.toString()} AS DECIMAL(14,4)), updatedAt = ${new Date()}
    WHERE organizationId = ${entry.organizationId}`;
  const rows = await readWalletRow(tx, entry.organizationId);
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
