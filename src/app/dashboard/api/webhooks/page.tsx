import Link from "next/link";
import { Webhook } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatDateTime, formatRelative } from "@/lib/format";
import { jsonStringArray } from "@/lib/utils";
import { WEBHOOK_EVENTS } from "@/services/messaging/outbound-webhooks";
import { listWebhooks } from "@/features/developers/service";
import { CreateWebhookDialog, WebhookMenu } from "@/features/developers/components/webhook-ui";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const { ctx, allowed } = await tenantWithPermission("api_keys:read");
  if (!allowed) return <PermissionDenied permission="api_keys:read" />;
  const hooks = await listWebhooks(ctx);
  const canManage = can(ctx, "api_keys:manage");
  return (
    <>
      <PageHeader
        title="Webhooks"
        description={
          <>
            Receive delivery reports and campaign events on your server.{" "}
            <Link href="/docs/webhooks" className="font-medium text-primary hover:underline" target="_blank">
              How to verify signatures
            </Link>
          </>
        }
        actions={canManage ? <CreateWebhookDialog events={WEBHOOK_EVENTS} /> : undefined}
      />
      {hooks.length === 0 ? (
        <Card>
          <EmptyState icon={Webhook} title="No endpoints yet" description="Add an HTTPS endpoint to be notified when messages are delivered or fail." action={canManage ? <CreateWebhookDialog events={WEBHOOK_EVENTS} /> : undefined} />
        </Card>
      ) : (
        <div className="space-y-4">
          {hooks.map((h) => (
            <Card key={h.id}>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="break-all font-mono text-sm">{h.url}</CardTitle>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge tone={h.active ? "success" : "neutral"}>{h.active ? "Active" : "Disabled"}</Badge>
                    {jsonStringArray(h.events).map((e) => (
                      <Badge key={e} tone="outline" className="font-mono">
                        {e}
                      </Badge>
                    ))}
                    {h.failureCount > 0 && <Badge tone="warning">{h.failureCount} recent failures</Badge>}
                  </div>
                  {h.description && <p className="mt-2 text-sm text-muted-foreground">{h.description}</p>}
                </div>
                {canManage && <WebhookMenu id={h.id} active={h.active} />}
              </CardHeader>
              <CardContent>
                <p className="mb-2 text-xs text-muted-foreground">
                  Last delivery: {h.lastDeliveryAt ? `${formatRelative(h.lastDeliveryAt)} (HTTP ${h.lastStatusCode ?? "no response"})` : "never"}
                </p>
                {h.deliveries.length > 0 && (
                  <ul className="divide-y divide-border rounded-md border border-border text-sm">
                    {h.deliveries.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                        <code className="font-mono text-xs">{d.event}</code>
                        <Badge tone={d.status === "SUCCEEDED" ? "success" : d.status === "FAILED" ? "danger" : "warning"}>{d.status.toLowerCase()}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {d.responseStatus ? `HTTP ${d.responseStatus}` : "no response"} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(d.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
