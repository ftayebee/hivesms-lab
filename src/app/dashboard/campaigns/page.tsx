import Link from "next/link";
import { Megaphone, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { DataTable, Pagination } from "@/components/ui/table";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getT } from "@/i18n/server";
import { campaignListQuery } from "@/features/campaigns/schemas";
import { CAMPAIGNS_PAGE_SIZE, listCampaigns } from "@/features/campaigns/service";
import { CampaignRowMenu } from "@/features/campaigns/components/campaign-controls";
import { cn } from "@/lib/utils";

export const metadata = { title: "Campaigns" };

const STATUSES = ["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PROCESSING", "PAUSED", "COMPLETED", "CANCELLED", "FAILED"] as const;

export default async function CampaignsPage({ searchParams }: PageProps<"/dashboard/campaigns">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("campaigns:read");
  if (!allowed) return <PermissionDenied permission="campaigns:read" />;
  const { t } = await getT();
  const q = campaignListQuery.parse(sp);
  const { rows, total, statusCounts } = await listCampaigns(ctx, q);
  const canWrite = can(ctx, "campaigns:write") && can(ctx, "sms:send");
  const statusLabel = (s: string) => t.status[s as keyof typeof t.status] ?? s;
  const filterHref = (status?: string) => {
    const p = new URLSearchParams();
    if (q.q) p.set("q", q.q);
    if (q.type) p.set("type", q.type);
    if (status) p.set("status", status);
    return `/dashboard/campaigns${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Every send from the composer is a campaign with its own delivery report."
        actions={
          canWrite ? (
            <Button asChild>
              <Link href="/dashboard/send">
                <Plus /> New campaign
              </Link>
            </Button>
          ) : undefined
        }
      />
      <nav aria-label="Filter by status" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        <Link href={filterHref()} className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", !q.status ? "border-primary bg-primary-soft font-medium text-primary" : "border-border hover:bg-muted")}>
          All
        </Link>
        {STATUSES.filter((s) => statusCounts[s]).map((s) => (
          <Link key={s} href={filterHref(s)} aria-current={q.status === s ? "true" : undefined} className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", q.status === s ? "border-primary bg-primary-soft font-medium text-primary" : "border-border hover:bg-muted")}>
            {statusLabel(s)} <span className="tabular text-muted-foreground">{statusCounts[s]}</span>
          </Link>
        ))}
      </nav>
      <Card>
        <form method="get" className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row" role="search">
          {q.status && <input type="hidden" name="status" value={q.status} />}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="cq" className="sr-only">
              Search campaigns
            </label>
            <Input id="cq" name="q" defaultValue={q.q} placeholder="Search by name" className="pl-9" />
          </div>
          <label htmlFor="ctype" className="sr-only">
            Type
          </label>
          <NativeSelect id="ctype" name="type" defaultValue={q.type ?? ""} className="sm:w-44">
            <option value="">All types</option>
            <option value="TRANSACTIONAL">Transactional</option>
            <option value="PROMOTIONAL">Promotional</option>
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </form>
        <DataTable
          caption="Campaigns"
          rows={rows}
          getKey={(c) => c.id}
          empty={
            <EmptyState
              icon={Megaphone}
              title={q.q || q.status || q.type ? "No campaigns match" : "No campaigns yet"}
              description="Create a campaign to send a message to contact groups or a list of numbers."
              action={
                canWrite ? (
                  <Button asChild>
                    <Link href="/dashboard/send">New campaign</Link>
                  </Button>
                ) : undefined
              }
            />
          }
          columns={[
            {
              key: "name",
              header: "Campaign",
              mobile: "title",
              cell: (c) => (
                <Link href={`/dashboard/campaigns/${c.id}`} className="font-medium hover:text-primary">
                  {c.name}
                </Link>
              ),
            },
            { key: "type", header: "Type", cell: (c) => <Badge tone={c.smsType === "PROMOTIONAL" ? "warning" : "primary"}>{c.smsType === "PROMOTIONAL" ? "Promotional" : "Transactional"}</Badge> },
            { key: "recipients", header: "Recipients", align: "right", cell: (c) => formatNumber(c.recipientCount) },
            { key: "sent", header: "Sent", align: "right", cell: (c) => formatNumber(c.submittedCount) },
            { key: "delivered", header: "Delivered", align: "right", cell: (c) => <span className="text-success">{formatNumber(c.deliveredCount)}</span> },
            { key: "failed", header: "Failed", align: "right", cell: (c) => <span className={c.failedCount ? "text-destructive" : ""}>{formatNumber(c.failedCount)}</span> },
            { key: "status", header: "Status", cell: (c) => <StatusBadge status={c.status} label={statusLabel(c.status)} /> },
            { key: "created", header: "Created", cell: (c) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(c.createdAt)}</span> },
            { key: "scheduled", header: "Scheduled", cell: (c) => <span className="whitespace-nowrap text-muted-foreground">{c.scheduledAt ? formatDateTime(c.scheduledAt) : "-"}</span> },
            ...(canWrite ? [{ key: "menu", header: <span className="sr-only">Actions</span>, mobile: "hidden" as const, cell: (c: (typeof rows)[number]) => <CampaignRowMenu id={c.id} status={c.status} name={c.name} /> }] : []),
          ]}
        />
        {rows.length > 0 && <Pagination page={q.page} pageSize={CAMPAIGNS_PAGE_SIZE} total={total} searchParams={sp} basePath="/dashboard/campaigns" />}
      </Card>
    </>
  );
}
