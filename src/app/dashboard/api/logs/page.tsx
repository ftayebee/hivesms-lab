import Link from "next/link";
import { Activity, CheckCircle2, CircleAlert, ServerCrash } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination, parsePage } from "@/components/ui/table";
import { StatsCard } from "@/components/dashboard/stats-card";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { formatDateTime, formatNumber } from "@/lib/format";
import { API_LOG_PAGE, listApiLogs } from "@/features/developers/service";
import { cn } from "@/lib/utils";

export const metadata = { title: "API request logs" };

export default async function ApiLogsPage({ searchParams }: PageProps<"/dashboard/api/logs">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("api_keys:read");
  if (!allowed) return <PermissionDenied permission="api_keys:read" />;
  const status = sp.status === "2xx" || sp.status === "4xx" || sp.status === "5xx" ? sp.status : undefined;
  const page = parsePage(sp.page);
  const { rows, total, stats } = await listApiLogs(ctx, { page, status });
  return (
    <>
      <PageHeader title="Request logs" description="API requests made with your keys. Request and response bodies are not stored." />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Requests (24h)" value={formatNumber(stats.total)} icon={Activity} />
        <StatsCard label="Successful" value={formatNumber(stats.ok)} icon={CheckCircle2} tone="success" />
        <StatsCard label="Client errors (4xx)" value={formatNumber(stats.clientErrors)} icon={CircleAlert} tone="warning" />
        <StatsCard label="Server errors (5xx)" value={formatNumber(stats.serverErrors)} icon={ServerCrash} tone="danger" />
      </div>
      <nav aria-label="Filter by status" className="mb-4 flex gap-2">
        {[undefined, "2xx", "4xx", "5xx"].map((s) => (
          <Link key={s ?? "all"} href={`/dashboard/api/logs${s ? `?status=${s}` : ""}`} className={cn("rounded-full border px-3 py-1 text-sm", status === s ? "border-primary bg-primary-soft font-medium text-primary" : "border-border hover:bg-muted")}>
            {s ?? "All"}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Activity} title="No requests yet" description="Requests appear here as soon as your application calls the API." />
        ) : (
          <>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">API request log</caption>
                <thead className="bg-surface/70">
                  <tr>
                    {["Time", "Request", "Status", "Error", "Duration", "Key", "IP", "Request ID"].map((h) => (
                      <th key={h} scope="col" className="h-10 whitespace-nowrap border-b border-border px-4 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                        <Badge tone={r.method === "GET" ? "accent" : "primary"} className="mr-2 font-mono">
                          {r.method}
                        </Badge>
                        {r.path}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={r.statusCode < 400 ? "success" : r.statusCode < 500 ? "warning" : "danger"} className="font-mono">
                          {r.statusCode}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.errorCode ?? "-"}</td>
                      <td className="px-4 py-2.5 tabular text-muted-foreground">{r.durationMs} ms</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">{r.apiKey ? r.apiKey.name : "-"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.ipAddress ?? "-"}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{r.requestId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={API_LOG_PAGE} total={total} searchParams={sp} basePath="/dashboard/api/logs" />
          </>
        )}
      </Card>
    </>
  );
}
