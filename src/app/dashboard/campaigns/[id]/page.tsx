import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCheck, CircleAlert, Clock, Coins, Download, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert, Progress } from "@/components/ui/misc";
import { Pagination, parsePage } from "@/components/ui/table";
import { StatsCard } from "@/components/dashboard/stats-card";
import { StatusBreakdown } from "@/components/dashboard/status-breakdown";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { isAppError } from "@/lib/errors";
import { formatBDT, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { formatBdPhone } from "@/lib/phone";
import { getT } from "@/i18n/server";
import { getCampaignDetail, listCampaignMessages } from "@/features/campaigns/service";
import { CampaignControls } from "@/features/campaigns/components/campaign-controls";
import { cn } from "@/lib/utils";

export const metadata = { title: "Campaign" };

const TIMELINE_LABELS: Record<string, string> = {
  "campaign.create": "Draft created",
  "campaign.duplicate": "Created as a copy",
  "campaign.submit_for_review": "Submitted for review",
  "campaign.schedule": "Scheduled for sending",
  "campaign.approve": "Approved by review team",
  "campaign.reject": "Rejected by review team",
  "campaign.launch": "Sending started (wallet charged)",
  "campaign.pause": "Paused",
  "campaign.resume": "Resumed",
  "campaign.cancel": "Cancelled",
  "campaign.export": "Report exported",
};

const SKIP_LABELS: Record<string, string> = {
  SKIPPED_SUPPRESSED: "Opted out / suppressed",
  SKIPPED_INVALID: "Invalid number",
  SKIPPED_DUPLICATE: "Duplicate",
  SKIPPED_BLOCKED: "Blocked number",
};

const MSG_STATUSES = ["QUEUED", "SUBMITTED", "DELIVERED", "FAILED", "REJECTED", "EXPIRED", "CANCELLED"] as const;

export default async function CampaignDetailPage({ params, searchParams }: PageProps<"/dashboard/campaigns/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ctx, allowed } = await tenantWithPermission("campaigns:read");
  if (!allowed) return <PermissionDenied permission="campaigns:read" />;
  const { t } = await getT();
  let detail;
  try {
    detail = await getCampaignDetail(ctx, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { campaign: c, stats, failures, operators, timeline, skipped, createdBy } = detail;
  const page = parsePage(sp.page);
  const statusFilter = MSG_STATUSES.find((s) => s === sp.status);
  const messages = await listCampaignMessages(ctx, id, { status: statusFilter, page, pageSize: 25 });
  const statusLabel = (s: string) => t.status[s as keyof typeof t.status] ?? s;
  const pending = stats.queued + stats.sent;
  const finals = stats.delivered + stats.failed;
  const live = c.status === "PROCESSING" || (c.status === "COMPLETED" && stats.sent > 0) || c.status === "SCHEDULED";
  const canWrite = can(ctx, "campaigns:write") && can(ctx, "sms:send");

  return (
    <>
      {live && <AutoRefresh intervalMs={c.status === "SCHEDULED" ? 15000 : 4000} />}
      <PageHeader
        back={{ href: "/dashboard/campaigns", label: "Campaigns" }}
        title={c.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={c.status} label={statusLabel(c.status)} />
            <Badge tone={c.smsType === "PROMOTIONAL" ? "warning" : "primary"}>{c.smsType === "PROMOTIONAL" ? "Promotional" : "Transactional"}</Badge>
            <span>Created {formatDateTime(c.createdAt)}{createdBy ? ` by ${createdBy}` : ""}</span>
          </span>
        }
        actions={
          <>
            {can(ctx, "reports:export") && stats.total > 0 && (
              <Button asChild variant="secondary">
                <a href={`/api/v1/app/campaigns/${c.id}/export`}>
                  <Download /> Export report
                </a>
              </Button>
            )}
            {canWrite && <CampaignControls id={c.id} status={c.status} />}
          </>
        }
      />

      {c.status === "PENDING_REVIEW" && (
        <Alert tone="warning" className="mb-6" title="Waiting for review">
          Our team reviews this campaign before it is sent. {c.reviewNote ? `Reason: ${c.reviewNote}.` : ""} You will be notified of the decision. Nothing has been charged yet.
        </Alert>
      )}
      {c.status === "SCHEDULED" && (
        <Alert tone="info" className="mb-6" title={c.scheduledAt ? `Scheduled for ${formatDateTime(c.scheduledAt)} (Asia/Dhaka)` : "Starting now"}>
          The wallet is charged when sending starts. You can cancel until then.
        </Alert>
      )}
      {c.status === "FAILED" && (
        <Alert tone="danger" className="mb-6" title="This campaign could not start">
          {c.failureReason}
        </Alert>
      )}
      {c.status === "PAUSED" && (
        <Alert tone="warning" className="mb-6" title="Paused">
          {formatNumber(stats.queued)} messages are waiting. Resume to continue sending.
        </Alert>
      )}

      <section aria-label="Campaign statistics" className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-6">
        <StatsCard label="Recipients" value={formatNumber(c.recipientCount)} icon={Users} hint={c.skippedCount ? `${formatNumber(c.skippedCount)} skipped` : "All eligible"} />
        <StatsCard label="Sent" value={formatNumber(c.submittedCount)} icon={Send} hint="Accepted by provider" />
        <StatsCard label="Delivered" value={formatNumber(stats.delivered)} icon={CheckCheck} tone="success" hint={finals ? formatPercent(stats.delivered / finals) : "-"} />
        <StatsCard label="Failed" value={formatNumber(stats.failed)} icon={CircleAlert} tone="danger" hint="Refunded per policy" />
        <StatsCard label="Pending" value={formatNumber(pending)} icon={Clock} tone="primary" hint={stats.queued ? `${formatNumber(stats.queued)} in queue` : "Awaiting reports"} />
        <StatsCard
          label="Cost"
          value={formatBDT(c.status === "PENDING_REVIEW" || c.status === "SCHEDULED" || c.status === "DRAFT" ? c.estimatedCost.toString() : c.actualCost.toString())}
          icon={Coins}
          tone="warning"
          hint={Number(c.refundedAmount) > 0 ? `${formatBDT(c.refundedAmount.toString())} refunded` : c.status === "DRAFT" || c.status === "SCHEDULED" || c.status === "PENDING_REVIEW" ? "Estimate" : "Charged"}
        />
      </section>

      {stats.total > 0 && (
        <Card className="mt-6">
          <CardContent className="pt-5">
            <div className="mb-2 flex justify-between text-sm">
              <span className="font-medium">Progress</span>
              <span className="text-muted-foreground tabular">
                {formatNumber(finals)} of {formatNumber(stats.total)} final
              </span>
            </div>
            <Progress value={finals} max={Math.max(1, stats.total)} label="Campaign progress" tone={c.status === "COMPLETED" ? "success" : "primary"} />
            <div className="mt-5">
              <StatusBreakdown delivered={stats.delivered} pending={pending} failed={stats.failed} />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap rounded-lg bg-surface p-4 font-bangla text-[15px]">{c.message}</p>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                ["Sender ID", c.senderValue],
                ["Sender type", c.senderType === "MASKING" ? "Masking" : "Non-masking"],
                ["Encoding", c.encoding === "GSM7" ? "GSM-7" : "Unicode"],
                ["Segments", String(c.segmentsPerMessage)],
                ["Scheduled", c.scheduledAt ? formatDateTime(c.scheduledAt) : "Immediately"],
                ["Started", c.startedAt ? formatDateTime(c.startedAt) : "-"],
                ["Completed", c.completedAt ? formatDateTime(c.completedAt) : "-"],
                ["Template", c.template?.name ?? "-"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 font-medium">{v}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l border-border pl-5">
              {timeline.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
                  <p className="text-sm font-medium">{TIMELINE_LABELS[e.action] ?? e.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(e.at)}
                    {e.actor ? ` · ${e.actor}` : ""}
                  </p>
                  {e.action === "campaign.reject" && typeof e.metadata?.reason === "string" && <p className="mt-1 text-xs text-destructive">{e.metadata.reason}</p>}
                </li>
              ))}
              {c.completedAt && c.status === "COMPLETED" && (
                <li className="relative">
                  <span className="absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-card bg-success" aria-hidden />
                  <p className="text-sm font-medium">Sending completed</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(c.completedAt)}</p>
                </li>
              )}
            </ol>
          </CardContent>
        </Card>
      </div>

      {(failures.length > 0 || operators.length > 0 || Object.keys(skipped).length > 0) && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
          {failures.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Failure reasons</CardTitle>
                <CardDescription>As reported by the provider</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {failures.map((f) => (
                    <li key={f.reason} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{f.reason}</span>
                      <span className="font-medium tabular">{formatNumber(f.count)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {operators.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>By operator</CardTitle>
                <CardDescription>By number prefix; ported numbers may differ</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  {operators.map((o) => (
                    <li key={o.operator}>
                      <div className="flex justify-between">
                        <span>{o.operator}</span>
                        <span className="tabular text-muted-foreground">
                          {formatNumber(o.delivered)}/{formatNumber(o.total)}
                        </span>
                      </div>
                      <Progress className="mt-1" value={o.delivered} max={Math.max(1, o.total)} label={`${o.operator} delivered`} tone="success" />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {Object.keys(skipped).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Skipped recipients</CardTitle>
                <CardDescription>Not sent and not charged</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {Object.entries(skipped).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{SKIP_LABELS[k] ?? k}</span>
                      <span className="font-medium tabular">{formatNumber(v)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {stats.total > 0 && (
        <Card className="mt-6">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle>Recipients</CardTitle>
            <nav aria-label="Filter recipients by status" className="flex flex-wrap gap-1.5">
              {[undefined, ...MSG_STATUSES].map((s) => (
                <Link
                  key={s ?? "all"}
                  href={`/dashboard/campaigns/${c.id}${s ? `?status=${s}` : ""}`}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", statusFilter === s ? "border-primary bg-primary-soft font-medium text-primary" : "border-border text-muted-foreground hover:bg-muted")}
                >
                  {s ? statusLabel(s) : "All"}
                </Link>
              ))}
            </nav>
          </CardHeader>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Recipient delivery status</caption>
              <thead className="bg-surface/70">
                <tr>
                  {["Recipient", "Status", "Operator", "Segments", "Cost", "Last update", "Error"].map((h) => (
                    <th key={h} scope="col" className="h-10 whitespace-nowrap border-y border-border px-4 text-left text-xs font-medium text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {messages.rows.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px]">{formatBdPhone(m.to)}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={m.status} label={statusLabel(m.status)} />
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{m.operator ?? "-"}</td>
                    <td className="px-4 py-2.5 tabular">{m.segments}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular">
                      {formatBDT(m.cost.toString())}
                      {m.refundedAt && <span className="ml-1 text-xs text-success">refunded</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(m.deliveredAt ?? m.failedAt ?? m.submittedAt ?? c.startedAt ?? c.createdAt)}</td>
                    <td className="max-w-64 truncate px-4 py-2.5 text-muted-foreground" title={m.errorMessage ?? undefined}>
                      {m.errorMessage ?? "-"}
                    </td>
                  </tr>
                ))}
                {messages.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No messages with this status.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={25} total={messages.total} searchParams={sp} basePath={`/dashboard/campaigns/${c.id}`} />
        </Card>
      )}
    </>
  );
}
