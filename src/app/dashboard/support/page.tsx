import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatRelative } from "@/lib/format";
import { getT } from "@/i18n/server";
import { siteConfig } from "@/config/site";
import { listTickets, TICKET_CATEGORIES, TICKET_PAGE } from "@/features/support/service";
import { NewTicketDialog } from "@/features/support/components/support-ui";
import { cn } from "@/lib/utils";

export const metadata = { title: "Support" };

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"] as const;
const PRIORITY_TONE = { LOW: "neutral", NORMAL: "outline", HIGH: "warning", URGENT: "danger" } as const;

export default async function SupportPage({ searchParams }: PageProps<"/dashboard/support">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("support:read");
  if (!allowed) return <PermissionDenied permission="support:read" />;
  const { t } = await getT();
  const status = STATUSES.find((s) => s === sp.status);
  const page = parsePage(sp.page);
  const { rows, total } = await listTickets(ctx, { status, page });
  const canWrite = can(ctx, "support:write");
  return (
    <>
      <PageHeader title="Support" description={`Tickets for your organization. Hours: ${siteConfig.contact.hours}.`} actions={canWrite ? <NewTicketDialog categories={TICKET_CATEGORIES} /> : undefined} />
      <nav aria-label="Filter by status" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {[undefined, ...STATUSES].map((s) => (
          <Link key={s ?? "all"} href={`/dashboard/support${s ? `?status=${s}` : ""}`} className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", status === s ? "border-primary bg-primary-soft font-medium text-primary" : "border-border hover:bg-muted")}>
            {s ? t.status[s] : "All"}
          </Link>
        ))}
      </nav>
      <Card>
        <DataTable
          caption="Support tickets"
          rows={rows}
          getKey={(r) => r.id}
          empty={<EmptyState icon={LifeBuoy} title="No tickets" description="Need help with sending, billing or sender IDs? Open a ticket." action={canWrite ? <NewTicketDialog categories={TICKET_CATEGORIES} /> : undefined} />}
          columns={[
            {
              key: "subject",
              header: "Ticket",
              mobile: "title",
              cell: (r) => (
                <Link href={`/dashboard/support/${r.id}`} className="hover:text-primary">
                  <span className="mr-2 font-mono text-xs text-muted-foreground">#{r.number}</span>
                  <span className="font-medium">{r.subject}</span>
                </Link>
              ),
            },
            { key: "category", header: "Category", cell: (r) => <span className="text-muted-foreground">{r.category}</span> },
            { key: "priority", header: "Priority", cell: (r) => <Badge tone={PRIORITY_TONE[r.priority]}>{r.priority.charAt(0) + r.priority.slice(1).toLowerCase()}</Badge> },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} label={t.status[r.status]} /> },
            { key: "replies", header: "Messages", align: "right", cell: (r) => r._count.messages },
            { key: "updated", header: "Last update", cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatRelative(r.lastReplyAt)}</span> },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={TICKET_PAGE} total={total} searchParams={sp} basePath="/dashboard/support" />}
      </Card>
    </>
  );
}
