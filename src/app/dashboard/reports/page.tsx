import Link from "next/link";
import { BarChart3, CheckCheck, CircleAlert, Clock, Download, Send, Sigma } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Progress } from "@/components/ui/misc";
import { Pagination, parsePage } from "@/components/ui/table";
import { StatsCard } from "@/components/dashboard/stats-card";
import { UsageChart } from "@/components/dashboard/charts";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatBDT, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { formatBdPhone } from "@/lib/phone";
import { getT } from "@/i18n/server";
import { parseRange } from "@/features/reports/range";
import { REPORT_PAGE_SIZE, reportFiltersSchema } from "@/features/reports/messages";
import { loadReportsPage } from "@/features/reports/page-data";
import { laravelPage } from "@/lib/laravel-api";

export const metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: PageProps<"/dashboard/reports">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("reports:read");
  if (!allowed) return <PermissionDenied permission="reports:read" />;
  const { t } = await getT();
  const range = parseRange(sp);
  const rawFilters = reportFiltersSchema.parse(sp);
  const page = parsePage(sp.page);

  const { totals, daily, operators, failures, messages, campaigns, senders } = await laravelPage(() => loadReportsPage(ctx, range, rawFilters, page));
  const statusLabel = (s: string) => t.status[s as keyof typeof t.status] ?? s;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === "string" && k !== "page") as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Reports"
        description={`Delivery reports for ${range.label.toLowerCase()} · Asia/Dhaka`}
        actions={
          can(ctx, "reports:export") ? (
            <Button asChild variant="secondary">
              <a href={`/api/v1/app/reports/export${qs ? `?${qs}` : ""}`}>
                <Download /> Download CSV
              </a>
            </Button>
          ) : undefined
        }
      />
      <div className="mb-4">
        <DateRangeFilter current={range.key} />
      </div>
      <form method="get" className="mb-6 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Report filters">
        {typeof sp.range === "string" && <input type="hidden" name="range" value={sp.range} />}
        {typeof sp.from === "string" && <input type="hidden" name="from" value={sp.from} />}
        {typeof sp.to === "string" && <input type="hidden" name="to" value={sp.to} />}
        <label className="sr-only" htmlFor="r-campaign">
          Campaign
        </label>
        <NativeSelect id="r-campaign" name="campaign" defaultValue={rawFilters.campaign ?? ""} className="lg:col-span-2">
          <option value="">All campaigns and API</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        <label className="sr-only" htmlFor="r-sender">
          Sender ID
        </label>
        <NativeSelect id="r-sender" name="sender" defaultValue={rawFilters.sender ?? ""}>
          <option value="">All senders</option>
          {senders.map((s) => (
            <option key={s.senderValue} value={s.senderValue}>
              {s.senderValue}
            </option>
          ))}
        </NativeSelect>
        <label className="sr-only" htmlFor="r-status">
          Status
        </label>
        <NativeSelect id="r-status" name="status" defaultValue={rawFilters.status ?? ""}>
          <option value="">Any status</option>
          {["QUEUED", "SUBMITTED", "DELIVERED", "FAILED", "REJECTED", "EXPIRED", "CANCELLED"].map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </NativeSelect>
        <label className="sr-only" htmlFor="r-recipient">
          Recipient
        </label>
        <Input id="r-recipient" name="recipient" defaultValue={rawFilters.recipient} placeholder="Recipient number" inputMode="tel" />
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" className="flex-1">
            Apply
          </Button>
          <Button asChild variant="ghost">
            <Link href={`/dashboard/reports?range=${range.key === "custom" ? "30d" : range.key}`}>Reset</Link>
          </Button>
        </div>
      </form>

      <section aria-label="Totals" className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatsCard label="Total" value={formatNumber(totals.total)} icon={Sigma} hint={`${formatNumber(totals.segments)} segments`} />
        <StatsCard label="Sent" value={formatNumber(totals.total - totals.queued)} icon={Send} hint="Left the queue" />
        <StatsCard label="Delivered" value={formatNumber(totals.delivered)} icon={CheckCheck} tone="success" hint={totals.deliveryRate === null ? "-" : `${formatPercent(totals.deliveryRate)} rate`} />
        <StatsCard label="Failed" value={formatNumber(totals.failed)} icon={CircleAlert} tone="danger" />
        <StatsCard label="Pending" value={formatNumber(totals.pending)} icon={Clock} tone="primary" />
      </section>

      {totals.total === 0 ? (
        <Card className="mt-6">
          <EmptyState icon={BarChart3} title="No messages match these filters" description="Change the date range or filters." />
        </Card>
      ) : (
        <>
          <div className="mt-6 grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Messages per day</CardTitle>
                <CardDescription>By current delivery status</CardDescription>
              </CardHeader>
              <CardContent>
                <UsageChart data={daily} height={240} />
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>By operator</CardTitle>
                  <CardDescription>By number prefix; ported numbers may differ</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-3 text-sm">
                    {operators.map((o) => (
                      <li key={o.operator}>
                        <div className="flex justify-between gap-2">
                          <span>{o.operator}</span>
                          <span className="tabular text-muted-foreground">
                            {formatNumber(o.total)} · {formatPercent(o.total ? o.delivered / o.total : 0)} delivered
                          </span>
                        </div>
                        <Progress className="mt-1" value={o.delivered} max={Math.max(1, o.total)} label={`${o.operator} delivered share`} tone="success" />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              {failures.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Top failure reasons</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {failures.map((f) => (
                        <li key={f.reason} className="flex justify-between gap-3">
                          <span className="text-muted-foreground">{f.reason}</span>
                          <span className="font-medium tabular">{formatNumber(f.count)}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Message log</CardTitle>
              <CardDescription>{formatNumber(messages.total)} messages</CardDescription>
            </CardHeader>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Message log</caption>
                <thead className="bg-surface/70">
                  <tr>
                    {["Time", "Recipient", "Status", "Source", "Sender", "Segments", "Cost", "Details"].map((h) => (
                      <th key={h} scope="col" className="h-10 whitespace-nowrap border-y border-border px-4 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {messages.rows.map((m) => (
                    <tr key={m.id} className="hover:bg-surface/60">
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(m.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[13px]">{formatBdPhone(m.to)}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={m.status} label={statusLabel(m.status)} />
                      </td>
                      <td className="px-4 py-2.5">
                        {m.campaign ? (
                          <Link href={`/dashboard/campaigns/${m.campaign.id}`} className="block max-w-40 truncate hover:text-primary">
                            {m.campaign.name}
                          </Link>
                        ) : (
                          <Badge tone="outline">{m.source === "API" ? "API" : "Dashboard"}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{m.senderValue}</td>
                      <td className="px-4 py-2.5 tabular">{m.segments}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular">{formatBDT(m.cost.toString())}</td>
                      <td className="px-4 py-2.5">
                        <Link href={`/dashboard/reports/messages/${m.id}`} className="text-primary hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={REPORT_PAGE_SIZE} total={messages.total} searchParams={sp} basePath="/dashboard/reports" />
          </Card>
        </>
      )}
    </>
  );
}
