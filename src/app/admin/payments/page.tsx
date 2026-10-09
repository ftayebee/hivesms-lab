import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { AdminActionButton } from "@/components/admin/admin-ui";
import { StatusTabs } from "@/components/admin/status-tabs";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { formatBDT, formatDateTime } from "@/lib/format";
import { ADMIN_PAGE, listPaymentsForAdmin } from "@/features/admin/service";
import { refundPaymentAction, reviewPaymentAction } from "@/features/admin/actions";
import { superAdminAvailable } from "@/features/admin/super-admin";

export const metadata = { title: "Payments" };

const STATUSES = ["AWAITING_VERIFICATION", "PENDING", "SUCCEEDED", "FAILED", "CANCELLED", "REFUNDED"];

export default async function AdminPaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  const session = await requirePlatform("admin:billing:read");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status);
  const page = parsePage(sp.page);
  const { rows, total } = await listPaymentsForAdmin({ status, page });
  const canManage = platformCan(session.user.platformRole, "admin:billing:manage");
  const canRefund = superAdminAvailable() && platformCan(session.user.platformRole, "admin:payments:refund");
  return (
    <>
      <PageHeader title="Payments" description="Verify manual transfers against your bank statement before approving. Approval credits the wallet and issues an invoice." />
      <StatusTabs basePath="/admin/payments" current={status} options={[{ label: "all" }, ...STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").toLowerCase() }))]} />
      <Card>
        <DataTable
          caption="Payments"
          rows={rows}
          getKey={(p) => p.id}
          empty={<EmptyState icon={CreditCard} title="No payments" />}
          columns={[
            { key: "org", header: "Customer", mobile: "title", cell: (p) => <Link href={`/admin/customers/${p.organization.id}`} className="font-medium hover:text-primary">{p.organization.name}</Link> },
            { key: "total", header: "Total", align: "right", cell: (p) => formatBDT(p.total.toString()) },
            { key: "credit", header: "Credit", align: "right", cell: (p) => formatBDT(p.creditAmount.toString()) },
            { key: "method", header: "Method", cell: (p) => <span className="text-muted-foreground">{p.method ?? p.provider}</span> },
            { key: "ref", header: "Reference", cell: (p) => <span className="font-mono text-xs">{p.manualReference ?? p.providerRef ?? "-"}</span> },
            { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { key: "date", header: "Created", cell: (p) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(p.createdAt)}</span> },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              mobile: "hidden",
              cell: (p) =>
                canManage && p.provider === "manual" && (p.status === "AWAITING_VERIFICATION" || p.status === "PENDING") ? (
                  <div className="flex gap-2">
                    <AdminActionButton action={reviewPaymentAction.bind(null, p.id, "approve")} label="Approve" variant="primary" confirmTitle={`Confirm ${formatBDT(p.total.toString())} received?`} confirmDescription={`Reference ${p.manualReference ?? "(none submitted)"}. ${formatBDT(p.creditAmount.toString())} will be credited.`} />
                    <AdminActionButton action={reviewPaymentAction.bind(null, p.id, "reject")} label="Reject" reason="required" variant="destructive" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {p.invoice && <span className="text-xs text-muted-foreground">{p.invoice.number}</span>}
                    {canRefund && p.status === "SUCCEEDED" && (
                      <AdminActionButton
                        action={refundPaymentAction.bind(null, p.id)}
                        label="Record refund"
                        variant="ghost"
                        reason="required"
                        reasonLabel="Reason (recorded; the customer is notified)"
                        password
                        confirmTitle={`Record a refund of ${formatBDT(p.total.toString())}?`}
                        confirmDescription={`${formatBDT(p.creditAmount.toString())} is removed from the customer's wallet (refused if they already used it) and the payment is marked refunded. Send the money back yourself through the original channel.`}
                      />
                    )}
                  </div>
                ),
            },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={ADMIN_PAGE} total={total} searchParams={sp} basePath="/admin/payments" />}
      </Card>
    </>
  );
}
