import type { Tx } from "@/lib/db";

/**
 * Gap-free named counters (replaces PostgreSQL sequences, which MySQL does not have).
 * Must run inside the caller's transaction: the UPDATE row-locks the counter until commit, so
 * concurrent callers are serialised and a rolled-back transaction does not consume a number.
 * Counters are seeded by migrations (invoice_number starts at 1000, first value 1001).
 */
export async function nextCounterValue(tx: Tx, name: string): Promise<bigint> {
  const changed = await tx.$executeRaw`UPDATE counters SET value = value + 1 WHERE name = ${name}`;
  if (!changed) throw new Error(`Counter "${name}" is missing; run prisma migrate deploy`);
  const rows = await tx.$queryRaw<{ value: bigint }[]>`SELECT value FROM counters WHERE name = ${name}`;
  return BigInt(rows[0].value);
}
