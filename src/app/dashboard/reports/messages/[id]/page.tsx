import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";
import { formatBDT, formatDateTime } from "@/lib/format";
import { formatBdPhone } from "@/lib/phone";
import { getT } from "@/i18n/server";
import { getMessage } from "@/features/reports/messages";

export const metadata = { title: "Message details" };

const SOURCE_LABEL = { SYSTEM: "Platform", PROVIDER_RESPONSE: "Provider response", PROVIDER_WEBHOOK: "Delivery report", PROVIDER_POLL: "Status check" } as const;

export default async function MessagePage({ params }: PageProps<"/dashboard/reports/messages/[id]">) {
  const { id } = await params;
  const { ctx, allowed } = await tenantWithPermission("reports:read");
  if (!allowed) return <PermissionDenied permission="reports:read" />;
  const { t } = await getT();
  let m;
  try {
    m = await getMessage(ctx, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const statusLabel = (s: string) => t.status[s as keyof typeof t.status] ?? s;
  return (
    <>
      <PageHeader back={{ href: "/dashboard/reports", label: "Reports" }} title={formatBdPhone(m.to)} description={<StatusBadge status={m.status} label={statusLabel(m.status)} />} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap rounded-lg bg-surface p-4 font-bangla">{m.body}</p>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              {[
                ["Sender", m.senderValue],
                ["Type", m.smsType === "PROMOTIONAL" ? "Promotional" : "Transactional"],
                ["Source", m.campaign ? "Campaign" : m.source === "API" ? `API${m.apiKey ? ` (${m.apiKey.name})` : ""}` : "Dashboard"],
                ["Encoding", m.encoding === "GSM7" ? "GSM-7" : "Unicode"],
                ["Segments", String(m.segments)],
                ["Cost", `${formatBDT(m.cost.toString())}${m.refundedAt ? " (refunded)" : ""}`],
                ["Operator (prefix)", m.operator ?? "-"],
                ["Reference", m.clientReference ?? "-"],
                ["Message ID", m.id],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="mt-0.5 break-all font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {m.campaign && (
              <p className="text-sm">
                Part of campaign{" "}
                <Link href={`/dashboard/campaigns/${m.campaign.id}`} className="font-medium text-primary hover:underline">
                  {m.campaign.name}
                </Link>
              </p>
            )}
            {m.errorMessage && (
              <p className="rounded-md border border-destructive/25 bg-destructive-soft px-3 py-2 text-sm">
                <span className="font-medium">Error:</span> {m.errorMessage} {m.errorCode && <Badge tone="outline" className="ml-1 font-mono">{m.errorCode}</Badge>}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delivery history</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative space-y-4 border-l border-border pl-5">
              {m.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[25px] top-1 size-2.5 rounded-full border-2 border-card bg-primary" aria-hidden />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={e.status} label={statusLabel(e.status)} />
                    <span className="text-xs text-muted-foreground">{SOURCE_LABEL[e.source]}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(e.occurredAt)}</p>
                  {e.description && <p className="mt-0.5 text-sm">{e.description}</p>}
                  {e.providerStatus && <p className="font-mono text-[11px] text-muted-foreground">provider status: {e.providerStatus}</p>}
                </li>
              ))}
              {m.events.length === 0 && <li className="text-sm text-muted-foreground">Queued {formatDateTime(m.queuedAt)}</li>}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
