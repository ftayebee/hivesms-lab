import Link from "next/link";
import { Building2, ChartColumn, Coins, Layers, Send } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { RangeFilter } from "@/components/admin/range-filter";
import { SpendChart, UsageChart } from "@/components/dashboard/charts";
import { StatsCard } from "@/components/dashboard/stats-card";
import { requirePlatform } from "@/lib/auth/session";
import { laravelPage } from "@/lib/laravel-api";
import { formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { parseRange, superAdminAvailable, usageOverview } from "@/features/admin/super-admin";

export const metadata = { title: "Customer usage" };

export default async function AdminUsagePage({ searchParams }: PageProps<"/admin/usage">) {
  await requirePlatform("admin:customers:read");
  const sp = await searchParams;
  if (!superAdminAvailable()) {
    return (
      <>
        <PageHeader title="Customer usage" />
        <Alert tone="info" title="Needs the Laravel admin API">
          Usage analytics are computed by the Laravel API. They appear once LARAVEL_FEATURES includes <code>admin</code>.
        </Alert>
      </>
    );
  }
  const range = parseRange(sp);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const page = parsePage(sp.page);
  const { rows, total, pageSize, totals, activeCustomers, series } = await laravelPage(() => usageOverview({ ...range, q: q || undefined, page }));

  return (
    <>
      <PageHeader title="Customer usage" description="How much each customer sends, how it fares and what they were charged. Refunded messages are not counted as charged." />
      <Card className="mb-6">
        <RangeFilter value={range}>
          <Input name="q" defaultValue={q} placeholder="Search by customer name" aria-label="Search by customer name" className="sm:w-56" />
        </RangeFilter>
      </Card>
      <section aria-label="Totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Messages" value={formatNumber(totals.messages)} icon={Send} tone="primary" />
        <StatsCard label="SMS segments" value={formatNumber(totals.segments)} icon={Layers} />
        <StatsCard label="Charged" value={formatBDT(totals.charged)} icon={Coins} tone="success" />
        <StatsCard label="Active customers" value={formatNumber(activeCustomers)} icon={Building2} hint="Sent at least one message" />
      </section>
      <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Messages per day</CardTitle>
            <CardDescription>All customers. Pending includes messages the gateway accepted but has not reported on.</CardDescription>
          </CardHeader>
          <CardContent>
            <UsageChart data={series} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Charged per day</CardTitle>
            <CardDescription>All customers, in BDT.</CardDescription>
          </CardHeader>
          <CardContent>
            <SpendChart data={series} />
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <DataTable
          caption="Usage by customer"
          rows={rows}
          getKey={(r) => r.id}
          empty={<EmptyState icon={ChartColumn} title="No customers found" />}
          columns={[
            { key: "name", header: "Customer", mobile: "title", cell: (r) => <Link href={`/admin/customers/${r.id}`} className="font-medium hover:underline">{r.name}</Link> },
            { key: "plan", header: "Plan", cell: (r) => <span className="text-muted-foreground">{r.plan ?? "Default"}</span> },
            { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            { key: "messages", header: "Messages", align: "right", cell: (r) => formatNumber(r.messages) },
            { key: "segments", header: "Segments", align: "right", cell: (r) => formatNumber(r.segments) },
            { key: "delivered", header: "Delivered", align: "right", cell: (r) => formatNumber(r.delivered) },
            { key: "pending", header: "Pending", align: "right", cell: (r) => formatNumber(r.pending) },
            { key: "failed", header: "Failed", align: "right", cell: (r) => formatNumber(r.failed) },
            { key: "charged", header: "Charged", align: "right", cell: (r) => formatBDT(r.charged) },
            { key: "last", header: "Last sent", cell: (r) => <span className="text-muted-foreground">{r.lastSentAt ? formatDateTime(r.lastSentAt) : "None in period"}</span> },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/usage" />}
      </Card>
    </>
  );
}
