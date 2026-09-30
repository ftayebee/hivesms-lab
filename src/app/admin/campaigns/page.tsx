import Link from "next/link";
import { Megaphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { AdminActionButton } from "@/components/admin/admin-ui";
import { StatusTabs } from "@/components/admin/status-tabs";
import { requirePlatform } from "@/lib/auth/session";
import { formatBDT, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { evaluateMessageRisk } from "@/services/risk";
import { ADMIN_PAGE, listCampaignsForAdmin } from "@/features/admin/service";
import { reviewCampaignAction } from "@/features/admin/actions";

export const metadata = { title: "Campaigns" };

function riskFor(c: { message: string; smsType: "TRANSACTIONAL" | "PROMOTIONAL"; recipientCount: number; organization: { createdAt: Date } }) {
  const ageDays = (Date.now() - c.organization.createdAt.getTime()) / 86_400_000;
  return evaluateMessageRisk({ message: c.message, smsType: c.smsType, recipientCount: c.recipientCount, organizationAgeDays: ageDays });
}

const STATUSES = ["PENDING_REVIEW", "SCHEDULED", "PROCESSING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"];

export default async function AdminCampaignsPage({ searchParams }: PageProps<"/admin/campaigns">) {
  await requirePlatform("admin:campaigns:review");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? (sp.status === "all" ? undefined : "PENDING_REVIEW");
  const page = parsePage(sp.page);
  const { rows, total } = await listCampaignsForAdmin({ status, page });
  return (
    <>
      <PageHeader title="Campaigns" description="Review queued campaigns before they send. Approve only lawful, consented messaging." />
      <StatusTabs basePath="/admin/campaigns" current={status ?? "all"} options={[...STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() })), { value: "all", label: "all" }]} />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title={status === "PENDING_REVIEW" ? "Nothing waiting for review" : "No campaigns"} />
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((c) => {
            const risk = riskFor(c);
            return (
              <Card key={c.id}>
                <CardContent className="grid gap-4 pt-5 lg:grid-cols-[1fr_auto]">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{c.name}</h2>
                      <StatusBadge status={c.status} />
                      <Badge tone={c.smsType === "PROMOTIONAL" ? "warning" : "primary"}>{c.smsType.toLowerCase()}</Badge>
                      <Badge tone="outline" className="font-mono">
                        {c.senderValue}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <Link href={`/admin/customers/${c.organization.id}`} className="font-medium text-foreground hover:text-primary">
                        {c.organization.name}
                      </Link>{" "}
                      · account age {formatRelative(c.organization.createdAt)} · {formatNumber(c.recipientCount)} recipients · est. {formatBDT(c.estimatedCost.toString())} ·{" "}
                      {c.scheduledAt ? `scheduled ${formatDateTime(c.scheduledAt)}` : "send immediately"}
                    </p>
                    <p className="whitespace-pre-wrap rounded-md bg-surface p-3 font-bangla text-sm">{c.message}</p>
                    {c.reviewNote && <p className="text-xs text-warning">Flagged: {c.reviewNote}</p>}
                    {risk.reasons.length > 0 && <p className="text-xs text-destructive">Risk signals: {risk.reasons.join("; ")}</p>}
                  </div>
                  {c.status === "PENDING_REVIEW" && (
                    <div className="flex items-start gap-2 lg:flex-col">
                      <AdminActionButton action={reviewCampaignAction.bind(null, c.id, "approve")} label="Approve" variant="primary" confirmTitle="Approve this campaign?" confirmDescription="It will send immediately or at its scheduled time. The customer is charged when sending starts." />
                      <AdminActionButton action={reviewCampaignAction.bind(null, c.id, "reject")} label="Reject" reason="required" variant="destructive" />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <Pagination page={page} pageSize={ADMIN_PAGE} total={total} searchParams={sp} basePath="/admin/campaigns" />
          </Card>
        </div>
      )}
    </>
  );
}
