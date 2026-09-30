import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { formatNumber, formatPercent } from "@/lib/format";

/**
 * Delivery status share as a single proportion bar with labelled counts. A bar reads more
 * accurately than a donut for three parts, and needs no client JavaScript.
 */
export function StatusBreakdown({ delivered, pending, failed }: { delivered: number; pending: number; failed: number }) {
  const total = delivered + pending + failed;
  const parts = [
    { key: "delivered", label: "Delivered", value: delivered, color: "var(--viz-delivered)", Icon: CheckCircle2 },
    { key: "pending", label: "Pending", value: pending, color: "var(--viz-pending)", Icon: Clock },
    { key: "failed", label: "Failed", value: failed, color: "var(--viz-failed)", Icon: XCircle },
  ];
  return (
    <div>
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={total ? parts.map((p) => `${p.label} ${formatPercent(p.value / total)}`).join(", ") : "No messages in this period"}
      >
        {total > 0 &&
          parts
            .filter((p) => p.value > 0)
            .map((p) => <div key={p.key} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="h-full first:rounded-l-full last:rounded-r-full" />)}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        {parts.map((p) => (
          <div key={p.key}>
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <p.Icon className="size-3.5" style={{ color: p.color }} aria-hidden />
              {p.label}
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular">{formatNumber(p.value)}</dd>
            <dd className="text-xs text-muted-foreground tabular">{total ? formatPercent(p.value / total) : "-"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
