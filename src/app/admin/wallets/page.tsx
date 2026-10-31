import Link from "next/link";
import { Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatsCard } from "@/components/dashboard/stats-card";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { walletsPage } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { formatBDT, formatDateTime } from "@/lib/format";

export const metadata = { title: "Wallets" };

export default async function AdminWalletsPage({ searchParams }: PageProps<"/admin/wallets">) {
  await requirePlatform("admin:billing:read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { rows, total, pageSize, sum, low } = await laravelPage(() => walletsPage(page));
  return (
    <>
      <PageHeader title="Wallets" description="Customer prepaid balances (a liability until used). Adjust a balance from the customer page." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatsCard label="Total customer balance" value={formatBDT(sum.toString())} icon={Wallet} tone="accent" />
        <StatsCard label="Wallets" value={String(total)} />
        <StatsCard label="Below alert threshold" value={String(low)} tone="warning" />
      </div>
      <Card>
        <DataTable
          caption="Wallets"
          rows={rows}
          getKey={(w) => w.id}
          empty={<EmptyState icon={Wallet} title="No wallets" />}
          columns={[
            { key: "org", header: "Customer", mobile: "title", cell: (w) => <Link href={`/admin/customers/${w.organization.id}`} className="font-medium hover:text-primary">{w.organization.name}</Link> },
            { key: "balance", header: "Balance", align: "right", cell: (w) => formatBDT(w.balance.toString()) },
            { key: "threshold", header: "Alert at", align: "right", cell: (w) => formatBDT(w.lowBalanceThreshold.toString()) },
            { key: "updated", header: "Last change", cell: (w) => <span className="text-muted-foreground">{formatDateTime(w.updatedAt)}</span> },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/wallets" />}
      </Card>
    </>
  );
}
