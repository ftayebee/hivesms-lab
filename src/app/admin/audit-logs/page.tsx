import Link from "next/link";
import { ScrollText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { auditLogsPage } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit logs" };

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit-logs">) {
  await requirePlatform("admin:audit:read");
  const sp = await searchParams;
  const action = typeof sp.action === "string" ? sp.action.trim().slice(0, 60) : "";
  const org = typeof sp.org === "string" && /^[0-9a-f-]{36}$/.test(sp.org) ? sp.org : undefined;
  const page = parsePage(sp.page);
  const { rows, total, pageSize } = await laravelPage(() => auditLogsPage({ action, org, page }));
  return (
    <>
      <PageHeader title="Audit logs" description="Append-only record of security-relevant and administrative actions. Secrets are never logged." />
      <Card>
        <form method="get" className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row" role="search">
          {org && <input type="hidden" name="org" value={org} />}
          <label htmlFor="aa" className="sr-only">
            Action prefix
          </label>
          <Input id="aa" name="action" defaultValue={action} placeholder="Action prefix, e.g. auth. or pricing." className="sm:w-80" />
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {org && (
            <Button asChild variant="ghost">
              <Link href="/admin/audit-logs">Clear customer filter</Link>
            </Button>
          )}
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No entries" />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {rows.map((a) => (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs font-semibold">{a.action}</code>
                    <Badge tone={a.actorType === "ADMIN" ? "warning" : a.actorType === "SYSTEM" ? "neutral" : a.actorType === "API_KEY" ? "accent" : "primary"}>{a.actorType.toLowerCase().replace("_", " ")}</Badge>
                    {a.actor && <span>{a.actor.name}</span>}
                    {a.organization && (
                      <Link href={`/admin/customers/${a.organization.id}`} className="text-muted-foreground hover:text-primary">
                        {a.organization.name}
                      </Link>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatDateTime(a.createdAt)}
                      {a.ipAddress ? ` · ${a.ipAddress}` : ""}
                    </span>
                  </div>
                  {a.metadata && Object.keys(a.metadata as object).length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
                      <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-surface p-2 font-mono text-[11px]">{JSON.stringify(a.metadata, null, 2)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/audit-logs" />
          </>
        )}
      </Card>
    </>
  );
}
