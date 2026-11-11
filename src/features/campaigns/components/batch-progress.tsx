import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/misc";
import { formatDateTime, formatNumber } from "@/lib/format";
import type { CampaignProgress } from "../laravel";

function duration(seconds: number) {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 5400) return `about ${Math.round(seconds / 60)} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

/**
 * Batch progress of a campaign, from Laravel's local records (never from the provider).
 * "Accepted" means the provider took the message; "Delivered" needs a delivery report.
 */
export function BatchProgress({ progress: p, status }: { progress: CampaignProgress; status: string }) {
  const items: Array<[string, number, string?]> = [
    ["Total recipients", p.total],
    ["Processed", p.processed],
    ["Accepted by provider", p.accepted],
    ["Delivered", p.delivered, "Needs a delivery report from the provider"],
    ["Failed", p.failed],
    ["Unconfirmed", p.unknown, "The provider did not confirm; not resent, under review"],
    ["Pending", p.pending],
    ["Processing now", p.processing],
  ];
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Batch progress</CardTitle>
        <CardDescription>
          Batches of {formatNumber(p.batchSize)} · batch {formatNumber(p.currentBatch)} of {formatNumber(p.totalBatches)}
          {p.lastBatchAt ? ` · last batch ${formatDateTime(p.lastBatchAt)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex justify-between text-sm">
            <span className="font-medium tabular">{p.percent}%</span>
            <span className="text-muted-foreground">
              {status === "PROCESSING" && p.estimatedSecondsRemaining !== null ? `${duration(p.estimatedSecondsRemaining)} remaining` : status === "PAUSED" ? "Paused" : ""}
            </span>
          </div>
          <Progress value={p.processed} max={Math.max(1, p.total)} label="Batch progress" tone={status === "COMPLETED" ? "success" : "primary"} />
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {items.map(([k, v, hint]) => (
            <div key={k} className="rounded-md bg-surface p-3" title={hint}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 font-semibold tabular">{formatNumber(v)}</dd>
            </div>
          ))}
        </dl>
        {p.unknown > 0 && (
          <p className="text-xs text-muted-foreground">
            {formatNumber(p.unknown)} messages have an unconfirmed provider outcome. They are never resent automatically (that could deliver them twice) and stay charged until our team confirms the result.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
