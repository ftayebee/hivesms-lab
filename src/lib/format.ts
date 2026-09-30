/**
 * Locale-aware formatting. All dates render in Asia/Dhaka regardless of server timezone.
 * Pure module: safe for client and server.
 */
export type Locale = "en" | "bn";

export const APP_TIMEZONE = "Asia/Dhaka";

const intlLocale = (locale: Locale) => (locale === "bn" ? "bn-BD" : "en-BD");

type MoneyLike = number | string | { toString(): string };

export function formatBDT(value: MoneyLike, locale: Locale = "en", opts: { decimals?: number } = {}): string {
  const n = typeof value === "number" ? value : Number(value.toString());
  const decimals = opts.decimals ?? 2;
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
  return locale === "bn" ? `৳${formatted}` : `BDT ${formatted}`;
}

/** Compact rate display, e.g. "BDT 0.35 / SMS". */
export function formatRate(value: MoneyLike, locale: Locale = "en"): string {
  return formatBDT(value, locale, { decimals: 2 });
}

export function formatNumber(value: number, locale: Locale = "en", opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(locale), opts).format(value);
}

export function formatCompact(value: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(intlLocale(locale), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number, locale: Locale = "en", decimals = 1): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(date: Date | string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatTime(date: Date | string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatRelative(date: Date | string, locale: Locale = "en", now = new Date()): string {
  const diffSec = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  return formatDate(date, locale);
}

/**
 * Parts of a date in Asia/Dhaka. Used for quiet-hour checks and day bucketing on the server,
 * independent of the host timezone.
 */
export function dhakaParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Asia/Dhaka is UTC+6 with no DST. */
export const DHAKA_OFFSET_MINUTES = 6 * 60;

/** Start of the current day in Asia/Dhaka, as a UTC Date. */
export function startOfDhakaDay(date: Date = new Date()): Date {
  const { year, month, day } = dhakaParts(date);
  return new Date(Date.UTC(year, month - 1, day) - DHAKA_OFFSET_MINUTES * 60_000);
}

export function startOfDhakaMonth(date: Date = new Date()): Date {
  const { year, month } = dhakaParts(date);
  return new Date(Date.UTC(year, month - 1, 1) - DHAKA_OFFSET_MINUTES * 60_000);
}

/** YYYY-MM-DD key in Asia/Dhaka (for chart buckets). */
export function dhakaDateKey(date: Date): string {
  const { year, month, day } = dhakaParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Converts a value from <input type="datetime-local"> interpreted as Asia/Dhaka time to UTC. */
export function dhakaLocalInputToDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - DHAKA_OFFSET_MINUTES * 60_000);
}

/** Formats a Date as a datetime-local input value in Asia/Dhaka. */
export function dateToDhakaLocalInput(date: Date): string {
  const { year, month, day, hour, minute } = dhakaParts(date);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${year}-${p(month)}-${p(day)}T${p(hour)}:${p(minute)}`;
}
