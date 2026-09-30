import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { StatusTabs } from "@/components/admin/status-tabs";
import { requirePlatform } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { ADMIN_PAGE, listTicketsForAdmin } from "@/features/admin/service";

export const metadata = { title: "Support" };

const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"] as const;

export default async function AdminSupportPage({ searchParams }: PageProps<"/admin/support">) {
  const session = await requirePlatform("admin:support");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const page = parsePage(sp.page);
  const { rows, total } = await listTicketsForAdmin({ status, page, mine: sp.mine === "1" ? session.user.id : undefined });
  return (
    <>
      <PageHeader title="Support" description="Highest priority first, then longest waiting." />
      <StatusTabs basePath="/admin/support" current={status} options={[{ label: "not closed" }, ...STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, " ").toLowerCase() }))]} />
      <Card>
        <DataTable
          caption="Tickets"
          rows={rows}
          getKey={(t) => t.id}
          empty={<EmptyState icon={LifeBuoy} title="No tickets" />}
          columns={[
            { key: "subject", header: "Ticket", mobile: "title", cell: (t) => <Link href={`/admin/support/${t.id}`} className="hover:text-primary"><span className="mr-2 font-mono text-xs text-muted-foreground">#{t.number}</span><span className="font-medium">{t.subject}</span></Link> },
            { key: "org", header: "Customer", cell: (t) => t.organization.name },
            { key: "priority", header: "Priority", cell: (t) => <Badge tone={t.priority === "URGENT" ? "danger" : t.priority === "HIGH" ? "warning" : "neutral"}>{t.priority.toLowerCase()}</Badge> },
            { key: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
            { key: "assignee", header: "Assignee", cell: (t) => <span className="text-muted-foreground">{t.assignedTo?.name ?? "Unassigned"}</span> },
            { key: "updated", header: "Last reply", cell: (t) => <span className="whitespace-nowrap text-muted-foreground">{formatRelative(t.lastReplyAt)}</span> },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={ADMIN_PAGE} total={total} searchParams={sp} basePath="/admin/support" />}
      </Card>
    </>
  );
}
