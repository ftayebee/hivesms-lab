import { ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatDateTime, formatNumber } from "@/lib/format";
import { formatBdPhone } from "@/lib/phone";
import { CONTACTS_PAGE_SIZE, listSuppression } from "@/features/contacts/service";
import { AddSuppressionDialog, RemoveSuppressionButton } from "@/features/contacts/components/suppression-controls";

export const metadata = { title: "Opt-outs and suppression" };

const REASONS = { OPT_OUT: "Opted out", MANUAL: "Manual", COMPLAINT: "Complaint", INVALID: "Invalid number" } as const;

export default async function SuppressionPage({ searchParams }: PageProps<"/dashboard/contacts/suppression">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("contacts:read");
  if (!allowed) return <PermissionDenied permission="contacts:read" />;
  const page = parsePage(sp.page);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 30) : "";
  const { rows, total } = await listSuppression(ctx, page, q || undefined);
  const canWrite = can(ctx, "contacts:write");
  return (
    <>
      <PageHeader title="Opt-outs and suppression" description={`${formatNumber(total)} suppressed number${total === 1 ? "" : "s"}`} actions={canWrite ? <AddSuppressionDialog /> : undefined} />
      <Alert tone="info" className="mb-6">
        Numbers on this list are skipped automatically for promotional messages and are not charged. Transactional messages (OTPs, alerts) are still delivered. Opt-out replies such as STOP are added here automatically when your provider supports inbound messages.
      </Alert>
      <Card>
        <form method="get" className="flex gap-2 border-b border-border p-4" role="search">
          <label htmlFor="sq" className="sr-only">
            Search number
          </label>
          <Input id="sq" name="q" defaultValue={q} placeholder="Search number" className="max-w-xs" inputMode="tel" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={ShieldOff} title={q ? "No matching numbers" : "No suppressed numbers"} description="When someone opts out, their number appears here." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                  <span className="font-mono text-sm">{formatBdPhone(r.phone)}</span>
                  <Badge tone={r.reason === "OPT_OUT" ? "warning" : r.reason === "COMPLAINT" ? "danger" : "neutral"}>{REASONS[r.reason]}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{[r.source, r.note].filter(Boolean).join(" · ")}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                  {canWrite && <RemoveSuppressionButton id={r.id} phone={r.phone} />}
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={CONTACTS_PAGE_SIZE} total={total} searchParams={sp} basePath="/dashboard/contacts/suppression" />
          </>
        )}
      </Card>
    </>
  );
}
