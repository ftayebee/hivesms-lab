import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { laravel, laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { ReportImportWizard } from "@/features/report-import/components/report-import-wizard";
import type { ReportImportRecord } from "@/features/report-import/types";

export const metadata = { title: "Report import" };

/** Customers for the picker (up to 2,500, sorted by name). */
async function customers() {
  const out: { id: string; name: string }[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await laravel.get<Array<{ id: string; name: string }>>("admin/customers", { page });
    out.push(...res.data.map((o) => ({ id: o.id, name: o.name })));
    if (res.data.length === 0 || page >= Number(res.meta.totalPages ?? 1)) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Super admin: import SMS delivery reports from a CSV into a customer's message log (docs/24). */
export default async function ReportImportPage({ searchParams }: PageProps<"/admin/report-import">) {
  if (!laravelEnabled("reportImport")) notFound();
  await requirePlatform("admin:reports:import");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const customer = typeof sp.customer === "string" ? sp.customer : undefined;
  const [orgs, history] = await laravelPage(() => Promise.all([customers(), laravel.get<ReportImportRecord[]>("admin/report-imports", { page, organizationId: customer })]));

  return (
    <>
      <PageHeader
        title="Report import"
        description="Bring SMS sent from another panel or the provider portal into a customer's reports. Download the template, fill it, check the file, then import."
      />
      <ReportImportWizard customers={orgs} initialCustomer={customer && orgs.some((o) => o.id === customer) ? customer : undefined} />

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Import history</CardTitle>
          <CardDescription>
            {formatNumber(Number(history.meta.total ?? history.data.length))} {Number(history.meta.total ?? history.data.length) === 1 ? "import" : "imports"}
          </CardDescription>
        </CardHeader>
        {history.data.length === 0 ? (
          <EmptyState icon={History} title="No imports yet" description="Imported reports will be listed here." />
        ) : (
          <>
            <DataTable
              caption="Import history"
              rows={history.data}
              getKey={(i) => i.id}
              columns={[
                { key: "when", header: "Imported", cell: (i) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(i.createdAt)}</span> },
                {
                  key: "customer",
                  header: "Customer",
                  cell: (i) => (
                    <Link href={`/admin/customers/${i.organization.id}`} className="hover:text-primary">
                      {i.organization.name ?? "Deleted customer"}
                    </Link>
                  ),
                },
                {
                  key: "file",
                  header: "File",
                  cell: (i) => (
                    <div className="max-w-56">
                      <p className="truncate font-mono text-xs">{i.fileName}</p>
                      {i.note && <p className="truncate text-xs text-muted-foreground">{i.note}</p>}
                    </div>
                  ),
                },
                {
                  key: "rows",
                  header: "Messages",
                  cell: (i) => (
                    <span className="tabular">
                      {formatNumber(i.importedCount)}
                      {i.skippedCount > 0 && <span className="text-muted-foreground"> · {formatNumber(i.skippedCount)} skipped</span>}
                    </span>
                  ),
                },
                {
                  key: "period",
                  header: "Sent",
                  cell: (i) => (
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {i.firstSentAt ? `${formatDateTime(i.firstSentAt)} – ${formatDateTime(i.lastSentAt ?? i.firstSentAt)}` : "-"}
                    </span>
                  ),
                },
                {
                  key: "cost",
                  header: "Cost",
                  cell: (i) => (
                    <span className="whitespace-nowrap tabular">
                      {formatBDT(i.totalCost)} {i.charged ? <Badge tone="success">charged</Badge> : <Badge tone="outline">not charged</Badge>}
                    </span>
                  ),
                },
                { key: "by", header: "By", cell: (i) => <span className="text-xs">{i.createdBy?.name ?? "-"}</span> },
              ]}
            />
            <Pagination page={page} pageSize={Number(history.meta.pageSize ?? 25)} total={Number(history.meta.total ?? 0)} searchParams={sp} basePath="/admin/report-import" />
          </>
        )}
      </Card>
    </>
  );
}
