import { DHAKA_OFFSET_MINUTES, dhakaDateKey, startOfDhakaDay } from "@/lib/format";

/** Date-range presets for dashboards and reports (Asia/Dhaka calendar days). */
export const RANGE_PRESETS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "custom";

export interface DateRange {
  key: RangeKey;
  from: Date; // inclusive, UTC instant of Dhaka midnight
  to: Date; // exclusive
  label: string;
  days: number;
}

const DAY = 86_400_000;

function parseDhakaDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - DHAKA_OFFSET_MINUTES * 60_000);
  return isNaN(d.getTime()) ? null : d;
}

export function parseRange(sp: Record<string, string | string[] | undefined>, fallback: RangeKey = "30d"): DateRange {
  const key = (typeof sp.range === "string" ? sp.range : fallback) as RangeKey;
  const todayStart = startOfDhakaDay();
  if (key === "custom") {
    const from = typeof sp.from === "string" ? parseDhakaDate(sp.from) : null;
    const toDay = typeof sp.to === "string" ? parseDhakaDate(sp.to) : null;
    if (from && toDay && from <= toDay && toDay.getTime() - from.getTime() <= 366 * DAY) {
      const to = new Date(toDay.getTime() + DAY);
      const days = Math.round((to.getTime() - from.getTime()) / DAY);
      return { key, from, to, days, label: `${dhakaDateKey(from)} to ${dhakaDateKey(toDay)}` };
    }
  }
  const preset = RANGE_PRESETS.find((p) => p.key === key) ?? RANGE_PRESETS.find((p) => p.key === fallback)!;
  const from = new Date(todayStart.getTime() - (preset.days - 1) * DAY);
  return { key: preset.key, from, to: new Date(todayStart.getTime() + DAY), days: preset.days, label: preset.label };
}

/** Every Dhaka day key in the range, for zero-filled chart series. */
export function dayKeys(range: DateRange): string[] {
  const out: string[] = [];
  for (let t = range.from.getTime(); t < range.to.getTime(); t += DAY) out.push(dhakaDateKey(new Date(t)));
  return out;
}

/**
 * The range as query parameters for the Laravel API (DateRange::fromQuery accepts the same presets
 * and custom from/to as Dhaka calendar days, `to` inclusive).
 */
export function rangeToQuery(range: DateRange): { range: string; from?: string; to?: string } {
  if (range.key !== "custom") return { range: range.key };
  return { range: "custom", from: dhakaDateKey(range.from), to: dhakaDateKey(new Date(range.to.getTime() - DAY)) };
}
