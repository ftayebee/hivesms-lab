import Link from "next/link";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { StatusTabs } from "@/components/admin/status-tabs";
import { requirePlatform } from "@/lib/auth/session";
import { apiLogsPage } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "API logs" };

export default async function AdminApiLogsPage({ searchParams }: PageProps<"/admin/api-logs">) {
  await requirePlatform("admin:messages:read");
  const sp = await searchParams;
  const status = sp.status === "4xx" || sp.status === "5xx" ? sp.status : undefined;
  const page = parsePage(sp.page);
  const { rows, total, pageSize } = await laravelPage(() => apiLogsPage({ status, page }));
  return (
    <>
      <PageHeader title="API logs" description="All customer API requests. Bodies are never stored." />
      <StatusTabs basePath="/admin/api-logs" current={status} options={[{ label: "all" }, { value: "4xx", label: "4xx" }, { value: "5xx", label: "5xx" }]} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Activity} title="No requests" />
        ) : (
          <>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">API logs</caption>
                <thead className="bg-surface/70">
                  <tr>
                    {["Time", "Customer", "Request", "Status", "Error", "ms", "Key", "IP"].map((h) => (
                      <th key={h} scope="col" className="h-10 whitespace-nowrap border-b border-border px-4 text-left text-xs font-medium text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                      <td className="px-4 py-2">{r.organization ? <Link href={`/admin/customers/${r.organization.id}`} className="hover:text-primary">{r.organization.name}</Link> : "-"}</td>
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-xs">
                        {r.method} {r.path}
                      </td>
                      <td className="px-4 py-2">
                        <Badge tone={r.statusCode < 400 ? "success" : r.statusCode < 500 ? "warning" : "danger"} className="font-mono">
                          {r.statusCode}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.errorCode ?? "-"}</td>
                      <td className="px-4 py-2 tabular text-muted-foreground">{r.durationMs}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.apiKey?.prefix ?? "-"}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.ipAddress ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/api-logs" />
          </>
        )}
      </Card>
    </>
  );
}
