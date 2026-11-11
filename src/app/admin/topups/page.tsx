import Link from "next/link";
import { notFound } from "next/navigation";
import { HandCoins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { StatusTabs } from "@/components/admin/status-tabs";
import { requirePlatform } from "@/lib/auth/session";
import { laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { formatBDT, formatDateTime } from "@/lib/format";
import { adminMethods, adminRequests } from "@/features/manual-topups/laravel";
import { TOPUP_BADGE, TOPUP_STATUS_LABEL, type TopUpStatus } from "@/features/manual-topups/types";

export const metadata = { title: "Manual payments" };

const STATUSES: TopUpStatus[] = ["pending", "under_review", "approved", "rejected", "cancelled"];

export default async function AdminTopUpsPage({ searchParams }: PageProps<"/admin/topups">) {
  if (!laravelEnabled("manualTopups")) notFound();
  await requirePlatform("admin:topups:review");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const status = STATUSES.find((s) => s === sp.status);
  const page = parsePage(sp.page);
  const [{ rows, total, pageSize }, methods] = await laravelPage(() =>
    Promise.all([adminRequests({ status, from: str("from"), to: str("to"), methodId: str("methodId"), q: str("q"), page }), adminMethods()]),
  );

  return (
    <>
      <PageHeader title="Manual payments" description="Customer claims of bKash, Nagad, Rocket and bank payments. Check each against the receiving account before approving: approval credits the wallet." />
      <StatusTabs basePath="/admin/topups" current={status} options={[{ label: "all" }, ...STATUSES.map((s) => ({ value: s, label: TOPUP_STATUS_LABEL[s].toLowerCase() }))]} />
      <Card className="mb-4">
        <CardContent className="pt-5">
          <form className="grid gap-3 sm:grid-cols-5" method="get">
            {status && <input type="hidden" name="status" value={status} />}
            <Input name="q" defaultValue={str("q")} placeholder="Customer or transaction ID" aria-label="Search" className="sm:col-span-2" />
            <NativeSelect name="methodId" defaultValue={str("methodId") ?? ""} aria-label="Payment method">
              <option value="">All methods</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </NativeSelect>
            <Input type="date" name="from" defaultValue={str("from")} aria-label="From" />
            <div className="flex gap-2">
              <Input type="date" name="to" defaultValue={str("to")} aria-label="To" />
              <Button type="submit" variant="secondary">
                Filter
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <DataTable
          caption="Manual payment requests"
          rows={rows}
          getKey={(r) => r.id}
          empty={<EmptyState icon={HandCoins} title="No requests" />}
          columns={[
            { key: "org", header: "Customer", mobile: "title", cell: (r) => <Link href={`/admin/topups/${r.id}`} className="font-medium hover:text-primary">{r.organization?.name ?? "—"}</Link> },
            { key: "amount", header: "Total", align: "right", cell: (r) => formatBDT(r.total) },
            { key: "method", header: "Method", cell: (r) => <span className="text-muted-foreground">{r.method}</span> },
            { key: "trx", header: "Transaction ID", cell: (r) => <span className="font-mono text-xs">{r.transactionId}</span> },
            { key: "sender", header: "Sender", cell: (r) => <span className="font-mono text-xs">{r.senderNumber ?? "—"}</span> },
            { key: "paid", header: "Paid", cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{r.paidAt ? formatDateTime(r.paidAt) : "—"}</span> },
            { key: "submitted", header: "Submitted", cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(r.submittedAt)}</span> },
            { key: "proof", header: "Proof", cell: (r) => (r.hasProof ? <a href={`/api/v1/admin/topup-requests/${r.id}/proof`} className="text-xs text-primary hover:underline">View</a> : <span className="text-xs text-muted-foreground">—</span>) },
            {
              key: "status",
              header: "Status",
              cell: (r) => (
                <span className="flex items-center gap-1.5">
                  <StatusBadge status={TOPUP_BADGE[r.status]} label={TOPUP_STATUS_LABEL[r.status]} />
                  {r.flags.length > 0 && <Badge tone="danger">check</Badge>}
                </span>
              ),
            },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/topups" />}
      </Card>
    </>
  );
}
