import { Decimal } from "decimal.js";

/**
 * Converters from Laravel JSON (camelCase, ISO-8601 UTC dates, money as decimal strings) to the
 * shapes the existing pages and components were written against (Date objects, Decimal money),
 * so the UI stays unchanged while the data source switches.
 */

/** Decimal from a Laravel money string ("12.3400"); null/undefined → 0. */
export function dec(value: string | number | null | undefined): Decimal {
  return new Decimal(value === null || value === undefined || value === "" ? 0 : value);
}

/** Decimal or null (nullable money columns such as cost or lowBalanceThreshold overrides). */
export function decOrNull(value: string | number | null | undefined): Decimal | null {
  return value === null || value === undefined || value === "" ? null : new Decimal(value);
}

export function date(value: string | Date): Date;
export function date(value: string | Date | null | undefined): Date | null;
export function date(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
// Only keys that are dates by naming convention are revived; free text that happens to look like
// a timestamp (a message body, a note) is never converted.
const DATE_KEY = /(At|Date|Until)$|^(date|from|to|periodStart|periodEnd)$/;

type Revived<T> = T extends string ? T | Date : T extends Array<infer U> ? Revived<U>[] : T extends object ? { [K in keyof T]: Revived<T[K]> } : T;

/** Deep copy of a Laravel payload with ISO timestamps under date-named keys turned into Date objects. */
export function reviveDates<T>(value: T): Revived<T> {
  return walk(value, undefined) as Revived<T>;
}

function walk(value: unknown, key: string | undefined): unknown {
  if (typeof value === "string") return key && DATE_KEY.test(key) && ISO.test(value) ? new Date(value) : value;
  if (Array.isArray(value)) return value.map((v) => walk(v, key));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, k)]));
  }
  return value;
}

/** Laravel list meta → the pagination shape the tables use. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function pageMeta(meta: Record<string, unknown>, fallbackPageSize = 25): PageMeta {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && !isNaN(Number(v)) ? Number(v) : d);
  const pageSize = num(meta.pageSize, fallbackPageSize);
  const total = num(meta.total, 0);
  return { page: num(meta.page, 1), pageSize, total, totalPages: num(meta.totalPages, Math.max(1, Math.ceil(total / Math.max(1, pageSize)))) };
}
