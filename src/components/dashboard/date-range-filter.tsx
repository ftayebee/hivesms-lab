"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

/** Date filter (Today / 7 / 30 / 90 days / Custom) that writes to the URL, so views are shareable. */
export function DateRangeFilter({ current, defaultKey = "30d" }: { current: string; defaultKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [from, setFrom] = useState(sp.get("from") ?? "");
  const [to, setTo] = useState(sp.get("to") ?? "");
  const [open, setOpen] = useState(false);

  function go(params: Record<string, string | null>) {
    const next = new URLSearchParams(sp.toString());
    next.delete("page");
    for (const [k, v] of Object.entries(params)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
      <div className="inline-flex rounded-md border border-border bg-card p-0.5 shadow-xs">
        {PRESETS.map((p) => {
          const active = (current || defaultKey) === p.key;
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => go({ range: p.key, from: null, to: null })}
              className={cn("h-7 rounded-[6px] px-2.5 text-[13px] font-medium transition-colors", active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={current === "custom" ? "subtle" : "secondary"} size="sm" aria-pressed={current === "custom"}>
            <CalendarRange /> Custom
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (from && to && from <= to) {
                go({ range: "custom", from, to });
                setOpen(false);
              }
            }}
          >
            <Field label="From">
              <DatePicker withTime={false} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} required />
            </Field>
            <Field label="To">
              <DatePicker withTime={false} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
            </Field>
            <Button type="submit" size="sm" className="w-full" disabled={!from || !to || from > to}>
              Apply
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
