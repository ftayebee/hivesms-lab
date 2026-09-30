import { CheckCheck, CircleAlert, Send, Wallet } from "lucide-react";
import { StatsCard } from "@/components/dashboard/stats-card";
import { StackedAreaSvg } from "@/components/dashboard/svg-chart";
import { StatusBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";

/**
 * Product preview for the homepage hero, built from the same components the dashboard uses.
 * All numbers are SAMPLE DATA and labelled as such; they are not performance claims.
 */
const sample = [
  { day: "Mon", delivered: 820, failed: 31, pending: 12 },
  { day: "Tue", delivered: 1140, failed: 44, pending: 9 },
  { day: "Wed", delivered: 960, failed: 38, pending: 15 },
  { day: "Thu", delivered: 1510, failed: 57, pending: 21 },
  { day: "Fri", delivered: 1320, failed: 49, pending: 18 },
  { day: "Sat", delivered: 1780, failed: 62, pending: 25 },
  { day: "Sun", delivered: 1605, failed: 58, pending: 20 },
];

const campaigns = [
  { name: "Order confirmations", status: "PROCESSING", sent: 1204, total: 1500 },
  { name: "Eid offer (opted-in)", status: "SCHEDULED", sent: 0, total: 8200 },
  { name: "Fee reminder, Class 9", status: "COMPLETED", sent: 640, total: 640 },
];

export function HeroPreview() {
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-4 -z-10 rounded-[20px] bg-[radial-gradient(70%_60%_at_70%_30%,var(--accent-soft),transparent_70%)]" />
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg" role="img" aria-label="Dashboard preview showing sample SMS statistics, a delivery chart and recent campaigns">
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
          </div>
          <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Sample data</span>
        </div>
        <div className="space-y-3 p-3 sm:p-4" aria-hidden>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatsCard label="SMS sent" value="9,452" icon={Send} hint="Last 7 days" className="p-3" />
            <StatsCard label="Delivered" value="9,135" icon={CheckCheck} tone="success" hint="Rate 96.6%" className="p-3" />
            <StatsCard label="Failed" value="339" icon={CircleAlert} tone="danger" hint="Refunded per policy" className="p-3" />
            <StatsCard label="Balance" value="BDT 12,480" icon={Wallet} tone="accent" hint="≈ 35,600 SMS" className="p-3" />
          </div>
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Delivery status, last 7 days</p>
              <StackedAreaSvg
                title="Delivery status"
                data={sample}
                height={150}
                series={[
                  { key: "delivered", label: "Delivered", color: "var(--viz-delivered)" },
                  { key: "pending", label: "Pending", color: "var(--viz-pending)" },
                  { key: "failed", label: "Failed", color: "var(--viz-failed)" },
                ]}
              />
            </div>
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">Recent campaigns</p>
              <ul className="space-y-3">
                {campaigns.map((c) => (
                  <li key={c.name}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{c.name}</span>
                      <StatusBadge status={c.status} label={c.status === "PROCESSING" ? "Sending" : undefined} />
                    </div>
                    <Progress className="mt-1.5" value={c.sent} max={c.total} label={`${c.name} progress`} tone={c.status === "COMPLETED" ? "success" : "primary"} />
                    <p className="mt-1 text-[11px] text-muted-foreground tabular">
                      {c.sent.toLocaleString("en-US")} / {c.total.toLocaleString("en-US")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
