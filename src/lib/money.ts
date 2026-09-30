/**
 * Money helpers. Amounts are BDT. On the server, Prisma returns Decimal objects; convert to
 * strings/numbers only at the edges (display, JSON). All arithmetic that affects balances uses
 * Decimal, never floating point.
 */
import { Decimal } from "decimal.js";

export { Decimal };

export type MoneyInput = Decimal | string | number | { toString(): string };

export function toDecimal(value: MoneyInput | null | undefined): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(typeof value === "number" ? value : value.toString());
}

/** Rounds to 2 decimal places (poisha) using banker-safe half-up rounding for display/charges. */
export function roundMoney(value: MoneyInput): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Rounds to 4 decimal places (storage precision). */
export function roundStorage(value: MoneyInput): Decimal {
  return toDecimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function moneyToNumber(value: MoneyInput | null | undefined): number {
  return toDecimal(value).toNumber();
}

/** Serialises Decimal fields for JSON responses (string keeps precision). */
export function moneyToString(value: MoneyInput | null | undefined, dp = 2): string {
  return toDecimal(value).toFixed(dp);
}
