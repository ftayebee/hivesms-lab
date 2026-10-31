import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import type { RangeQuery } from "@/features/admin/super-admin";

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Custom (up to 366 days)" },
];

/** GET form for the Dhaka-calendar date range used by the Super Admin finance pages. */
export function RangeFilter({ value, hidden = {}, children }: { value: RangeQuery; hidden?: Record<string, string | undefined>; children?: React.ReactNode }) {
  return (
    <form method="get" className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:flex-wrap sm:items-center" aria-label="Date range">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label htmlFor="rf-range" className="sr-only">
        Period
      </label>
      <NativeSelect id="rf-range" name="range" defaultValue={value.range ?? "30d"} className="sm:w-52">
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </NativeSelect>
      <label htmlFor="rf-from" className="sr-only">
        From
      </label>
      <Input id="rf-from" type="date" name="from" defaultValue={value.from} className="sm:w-40" title="From (custom period)" />
      <label htmlFor="rf-to" className="sr-only">
        To
      </label>
      <Input id="rf-to" type="date" name="to" defaultValue={value.to} className="sm:w-40" title="To (custom period)" />
      {children}
      <Button type="submit" variant="secondary">
        Apply
      </Button>
    </form>
  );
}

export function rangeParams(q: RangeQuery): string {
  const p = new URLSearchParams();
  if (q.range) p.set("range", q.range);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  return p.toString();
}
