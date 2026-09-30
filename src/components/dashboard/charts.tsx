"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";
import { formatBDT, formatNumber } from "@/lib/format";

/**
 * Dashboard charts. Conventions (see dataviz guidance): one y-axis, thin marks with 2px surface
 * gaps, status colors only for delivery status, legend for >= 2 series, tooltip on hover, and a
 * visually hidden table for screen readers.
 */
export interface DailyDatum {
  day: string; // YYYY-MM-DD (Asia/Dhaka)
  delivered: number;
  failed: number;
  pending: number;
  spend: number;
}

const STATUS_SERIES = [
  { key: "delivered", label: "Delivered", color: "var(--viz-delivered)" },
  { key: "pending", label: "Pending", color: "var(--viz-pending)" },
  { key: "failed", label: "Failed", color: "var(--viz-failed)" },
] as const;

const shortDay = (d: string) => {
  const [, m, day] = d.split("-");
  return `${Number(day)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]}`;
};

const axisProps = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="min-w-40 rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-medium">{title}</p>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />}
            {r.label}
          </span>
          <span className="font-medium tabular text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: readonly { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function SrTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

/** SMS usage over time: stacked delivery status per day. */
export function UsageChart({ data, height = 260 }: { data: DailyDatum[]; height?: number }) {
  const StatusTooltip = ({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload as DailyDatum;
    return (
      <TooltipBox
        title={shortDay(String(label))}
        rows={[
          ...STATUS_SERIES.map((s) => ({ label: s.label, value: formatNumber(d[s.key]), color: s.color })),
          { label: "Total", value: formatNumber(d.delivered + d.failed + d.pending) },
        ]}
      />
    );
  };
  return (
    <div>
      <Legend items={STATUS_SERIES} />
      <div className="mt-3" style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={24} {...axisProps} />
            <YAxis allowDecimals={false} width={44} tickFormatter={(v) => formatNumber(v, "en", { notation: "compact" })} {...axisProps} />
            <Tooltip content={StatusTooltip} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
            {STATUS_SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="status"
                fill={s.color}
                stroke="var(--card)"
                strokeWidth={1}
                radius={i === STATUS_SERIES.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption="SMS by day and status" headers={["Day", "Delivered", "Pending", "Failed"]} rows={data.map((d) => [d.day, d.delivered, d.pending, d.failed])} />
    </div>
  );
}

/** Spending over time (single series; no legend needed). */
export function SpendChart({ data, height = 220 }: { data: DailyDatum[]; height?: number }) {
  const SpendTooltip = ({ active, payload, label }: TooltipContentProps<TooltipValueType, string | number>) => {
    if (!active || !payload?.length) return null;
    return <TooltipBox title={shortDay(String(label))} rows={[{ label: "Spend", value: formatBDT(Number(payload[0].value)), color: "var(--chart-2)" }]} />;
  };
  return (
    <div>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tickFormatter={shortDay} minTickGap={24} {...axisProps} />
            <YAxis width={52} tickFormatter={(v) => formatNumber(v, "en", { notation: "compact" })} {...axisProps} />
            <Tooltip content={SpendTooltip} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
            <Area type="linear" dataKey="spend" stroke="var(--chart-2)" strokeWidth={2} fill="url(#spendFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption="Spend by day (BDT)" headers={["Day", "Spend"]} rows={data.map((d) => [d.day, d.spend.toFixed(2)])} />
    </div>
  );
}

export interface CampaignPerf {
  name: string;
  delivered: number;
  failed: number;
  pending: number;
}

/** Campaign performance: horizontal stacked bars per campaign. */
export function CampaignPerformanceChart({ data }: { data: CampaignPerf[] }) {
  const PerfTooltip = ({ active, payload }: TooltipContentProps<TooltipValueType, string | number>) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload as CampaignPerf;
    const total = d.delivered + d.failed + d.pending;
    return (
      <TooltipBox
        title={d.name}
        rows={[
          ...STATUS_SERIES.map((s) => ({ label: s.label, value: formatNumber(d[s.key]), color: s.color })),
          { label: "Delivery rate", value: total ? `${((d.delivered / Math.max(1, d.delivered + d.failed)) * 100).toFixed(1)}%` : "-" },
        ]}
      />
    );
  };
  const height = Math.max(120, data.length * 40 + 20);
  return (
    <div>
      <Legend items={STATUS_SERIES} />
      <div className="mt-3" style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis type="number" allowDecimals={false} {...axisProps} />
            <YAxis type="category" dataKey="name" width={130} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} {...axisProps} />
            <Tooltip content={PerfTooltip} cursor={{ fill: "var(--muted)", opacity: 0.6 }} />
            {STATUS_SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} stackId="c" fill={s.color} stroke="var(--card)" strokeWidth={1} radius={i === STATUS_SERIES.length - 1 ? [0, 4, 4, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption="Campaign performance" headers={["Campaign", "Delivered", "Pending", "Failed"]} rows={data.map((d) => [d.name, d.delivered, d.pending, d.failed])} />
    </div>
  );
}
