import Link from "next/link";
import { BadgeCheck, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { AdminActionButton } from "@/components/admin/admin-ui";
import { StatusTabs } from "@/components/admin/status-tabs";
import { requirePlatform } from "@/lib/auth/session";
import { formatBDT, formatDateTime } from "@/lib/format";
import type { StoredFile } from "@/services/storage";
import { ADMIN_PAGE, listSenderIdsForAdmin } from "@/features/admin/service";
import { reviewSenderIdAction } from "@/features/admin/actions";

export const metadata = { title: "Sender IDs" };

export default async function AdminSenderIdsPage({ searchParams }: PageProps<"/admin/sender-ids">) {
  await requirePlatform("admin:sender_ids:review");
  const sp = await searchParams;
  const status = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"].find((s) => s === sp.status) ?? (sp.status === "all" ? undefined : "PENDING");
  const page = parsePage(sp.page);
  const { rows, total } = await listSenderIdsForAdmin({ status, page });
  return (
    <>
      <PageHeader title="Sender IDs" description="Forward requests to the provider/operators, then record the outcome here. Customers are notified by email." />
      <StatusTabs basePath="/admin/sender-ids" current={status ?? "all"} options={[{ value: "PENDING", label: "pending" }, { value: "APPROVED", label: "approved" }, { value: "REJECTED", label: "rejected" }, { value: "SUSPENDED", label: "suspended" }, { value: "all", label: "all" }]} />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={BadgeCheck} title="Nothing here" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((s) => {
            const docs = (s.documents as unknown as StoredFile[]) ?? [];
            const fee = s.organization.pricingPlan?.senderIdFee;
            return (
              <Card key={s.id}>
                <CardContent className="space-y-3 pt-5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-semibold">{s.value}</span>
                    <StatusBadge status={s.status} />
                    <Badge tone="outline">{s.type === "MASKING" ? "masking" : "non-masking"}</Badge>
                  </div>
                  <p className="text-muted-foreground">
                    <Link href={`/admin/customers/${s.organization.id}`} className="font-medium text-foreground hover:text-primary">
                      {s.organization.name}
                    </Link>{" "}
                    · requested {formatDateTime(s.createdAt)}
                  </p>
                  {s.purpose && <p>{s.purpose}</p>}
                  {s.sampleMessage && <p className="rounded-md bg-surface px-3 py-2 font-bangla">{s.sampleMessage}</p>}
                  {s.rejectionReason && <p className="text-xs text-destructive">{s.rejectionReason}</p>}
                  {docs.length > 0 ? (
                    <ul className="flex flex-wrap gap-2">
                      {docs.map((d, i) => (
                        <li key={d.key}>
                          <a href={`/api/v1/admin/sender-ids/${s.id}/documents/${i}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                            <FileText className="size-3.5" aria-hidden /> {d.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">No documents attached.</p>
                  )}
                  {fee && Number(fee) > 0 && s.status === "PENDING" && <p className="text-xs text-muted-foreground">Approval charges a fee of {formatBDT(fee.toString())} to the customer.</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(s.status === "PENDING" || s.status === "SUSPENDED") && (
                      <AdminActionButton action={reviewSenderIdAction.bind(null, s.id, "APPROVED")} label="Approve" variant="primary" confirmTitle={`Approve ${s.value}?`} confirmDescription="Only approve after the provider/operator has confirmed the registration." reason="optional" reasonLabel="Internal note (optional)" extraField="Provider reference" />
                    )}
                    {s.status === "PENDING" && <AdminActionButton action={reviewSenderIdAction.bind(null, s.id, "REJECTED")} label="Reject" reason="required" variant="destructive" />}
                    {s.status === "APPROVED" && <AdminActionButton action={reviewSenderIdAction.bind(null, s.id, "SUSPENDED")} label="Suspend" reason="required" variant="destructive" />}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        <Card className="mt-4">
          <Pagination page={page} pageSize={ADMIN_PAGE} total={total} searchParams={sp} basePath="/admin/sender-ids" />
        </Card>
      )}
    </>
  );
}
