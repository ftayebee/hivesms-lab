import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/states";
import { AdminActionButton, AdminForm } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { isAppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { formatBDT, formatDate, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { getOrganizationDetail } from "@/features/admin/service";
import { adjustWalletAction, setOrgStatusAction, updateOrgControlsAction } from "@/features/admin/actions";

export const metadata = { title: "Customer" };

export default async function AdminCustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const session = await requirePlatform("admin:customers:read");
  const { id } = await params;
  let d;
  try {
    d = await getOrganizationDetail(id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { org } = d;
  const plans = await db.pricingPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
  const canManage = platformCan(session.user.platformRole, "admin:customers:manage");
  const canBilling = platformCan(session.user.platformRole, "admin:billing:manage");

  return (
    <>
      <PageHeader
        back={{ href: "/admin/customers", label: "Customers" }}
        title={org.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={org.status} />
            <span>
              Created {formatDate(org.createdAt)} · {org.industry ?? "No industry"} · plan {org.pricingPlan?.name ?? "default"}
            </span>
          </span>
        }
        actions={
          canManage ? (
            org.status === "ACTIVE" ? (
              <AdminActionButton action={setOrgStatusAction.bind(null, org.id, "SUSPENDED")} label="Suspend account" reason="required" reasonLabel="Reason (shown to the customer)" variant="destructive" size="md" confirmDescription="Sending stops immediately, API keys are rejected, and scheduled campaigns are paused." />
            ) : (
              <AdminActionButton action={setOrgStatusAction.bind(null, org.id, "ACTIVE")} label="Reactivate account" size="md" variant="primary" />
            )
          ) : undefined
        }
      />
      {org.status === "SUSPENDED" && (
        <Alert tone="danger" className="mb-6" title="Suspended">
          {org.suspendedReason}
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-3xl font-semibold tabular">{formatBDT(org.wallet?.balance.toString() ?? "0")}</p>
            <p className="text-sm text-muted-foreground">
              {formatNumber(d.sent30)} messages in 30 days · {formatNumber(d.failed30)} failed
            </p>
            {canBilling && (
              <AdminForm action={adjustWalletAction} submitLabel="Apply adjustment">
                <input type="hidden" name="orgId" value={org.id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Direction">
                    <NativeSelect name="direction" defaultValue="CREDIT">
                      <option value="CREDIT">Credit</option>
                      <option value="DEBIT">Debit</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Amount (BDT)" required>
                    <Input name="amount" type="number" min={0} step="0.01" />
                  </Field>
                </div>
                <Field label="Note" required hint="Visible in the customer's transaction history.">
                  <Textarea name="note" rows={2} maxLength={300} />
                </Field>
              </AdminForm>
            )}
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Account controls</CardTitle>
            <CardDescription>Anti-abuse limits and pricing. Changes are audited.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminForm action={updateOrgControlsAction} className="grid gap-4 sm:grid-cols-2" submitLabel="Save controls">
              <input type="hidden" name="id" value={org.id} />
              <fieldset disabled={!canManage} className="contents">
                <Field label="Daily send limit">
                  <Input name="dailySendLimit" type="number" min={0} defaultValue={org.dailySendLimit} />
                </Field>
                <Field label="Monthly send limit">
                  <Input name="monthlySendLimit" type="number" min={0} defaultValue={org.monthlySendLimit} />
                </Field>
                <Field label="Pricing plan">
                  <NativeSelect name="pricingPlanId" defaultValue={org.pricingPlanId ?? ""}>
                    <option value="">Default plan</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input type="checkbox" name="requireCampaignReview" defaultChecked={org.requireCampaignReview} className="size-4 accent-[var(--primary)]" />
                  Review promotional and large campaigns
                </label>
              </fieldset>
            </AdminForm>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border text-sm">
            {org.members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                <span className="font-medium">{m.user.name}</span>
                <span className="text-muted-foreground">{m.user.email}</span>
                <Badge tone="primary" className="ml-auto">
                  {m.role.name}
                </Badge>
                <span className="w-32 text-right text-xs text-muted-foreground">{m.user.lastLoginAt ? formatRelative(m.user.lastLoginAt) : "never"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sender IDs</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border text-sm">
            {org.senderIds.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-5 py-2.5">
                <span className="font-mono">{s.value}</span>
                <Badge tone="outline">{s.type === "MASKING" ? "masking" : "number"}</Badge>
                <StatusBadge status={s.status} className="ml-auto" />
              </li>
            ))}
            {org.senderIds.length === 0 && <li className="px-5 py-4 text-muted-foreground">None</li>}
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent campaigns</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border text-sm">
            {org.campaigns.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-xs text-muted-foreground tabular">{formatNumber(c.recipientCount)}</span>
                <StatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent payments and ledger</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border text-sm">
            {org.walletTransactions.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate">{t.description}</span>
                <span className={t.type === "CREDIT" ? "text-success tabular" : "tabular"}>
                  {t.type === "CREDIT" ? "+" : "−"}
                  {formatBDT(t.amount.toString())}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            <Link href={`/admin/audit-logs?org=${org.id}`} className="text-primary hover:underline">
              Full audit log
            </Link>
          </CardDescription>
        </CardHeader>
        <ul className="divide-y divide-border text-sm">
          {d.audits.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-2 px-5 py-2.5">
              <code className="font-mono text-xs">{a.action}</code>
              <span className="text-muted-foreground">{a.actor?.name ?? a.actorType.toLowerCase()}</span>
              <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
