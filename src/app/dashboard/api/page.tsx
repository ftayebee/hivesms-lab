import Link from "next/link";
import { BookOpen, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/table";
import { CopyButton } from "@/components/shared/copy-button";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatDate, formatRelative } from "@/lib/format";
import { jsonStringArray } from "@/lib/utils";
import { siteConfig } from "@/config/site";
import { listApiKeys } from "@/features/developers/service";
import { CreateApiKeyDialog, RevokeKeyButton } from "@/features/developers/components/api-key-ui";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const { ctx, allowed } = await tenantWithPermission("api_keys:read");
  if (!allowed) return <PermissionDenied permission="api_keys:read" />;
  const keys = await listApiKeys(ctx);
  const canManage = can(ctx, "api_keys:manage");
  const now = new Date();

  return (
    <>
      <PageHeader
        title="API"
        description="Send SMS from your own systems with the REST API."
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href="/docs/quick-start" target="_blank">
                <BookOpen /> Quick start
              </Link>
            </Button>
            {canManage && <CreateApiKeyDialog />}
          </>
        }
      />
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Base URL</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-surface px-3 py-2 font-mono text-[13px]">{siteConfig.apiBaseUrl}</code>
            <CopyButton value={siteConfig.apiBaseUrl} />
          </CardContent>
        </Card>
        <Alert tone="warning" title="Keep keys secret">
          Anyone with a key can send messages billed to your wallet. Store keys in a secret manager, never in mobile apps, browser code or repositories. Revoke a key immediately if it may have leaked.
        </Alert>
      </div>
      <Card>
        <DataTable
          caption="API keys"
          rows={keys}
          getKey={(k) => k.id}
          empty={<EmptyState icon={KeyRound} title="No API keys yet" description="Create a key to start sending from your application." action={canManage ? <CreateApiKeyDialog /> : undefined} />}
          columns={[
            {
              key: "name",
              header: "Key",
              mobile: "title",
              cell: (k) => (
                <div>
                  <p className="font-medium">{k.name}</p>
                  <code className="font-mono text-xs text-muted-foreground">{k.prefix}_••••••••</code>
                </div>
              ),
            },
            {
              key: "scopes",
              header: "Permissions",
              cell: (k) => (
                <div className="flex max-w-72 flex-wrap gap-1">
                  {jsonStringArray(k.scopes).map((s) => (
                    <Badge key={s} tone="outline" className="font-mono">
                      {s}
                    </Badge>
                  ))}
                  {jsonStringArray(k.ipAllowlist).length > 0 && <Badge tone="accent">{jsonStringArray(k.ipAllowlist).length} IP{jsonStringArray(k.ipAllowlist).length > 1 ? "s" : ""}</Badge>}
                </div>
              ),
            },
            { key: "created", header: "Created", cell: (k) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(k.createdAt)}</span> },
            { key: "used", header: "Last used", cell: (k) => <span className="whitespace-nowrap text-muted-foreground">{k.lastUsedAt ? formatRelative(k.lastUsedAt) : "Never"}</span> },
            {
              key: "status",
              header: "Status",
              cell: (k) => {
                const expired = k.status === "ACTIVE" && k.expiresAt && k.expiresAt < now;
                return expired ? <StatusBadge status="EXPIRED" label="Expired" /> : <StatusBadge status={k.status} label={k.status === "ACTIVE" ? (k.expiresAt ? `Active until ${formatDate(k.expiresAt)}` : "Active") : "Revoked"} />;
              },
            },
            ...(canManage ? [{ key: "actions", header: <span className="sr-only">Actions</span>, mobile: "hidden" as const, align: "right" as const, cell: (k: (typeof keys)[number]) => (k.status === "ACTIVE" ? <RevokeKeyButton id={k.id} name={k.name} /> : null) }] : []),
          ]}
        />
      </Card>
    </>
  );
}
