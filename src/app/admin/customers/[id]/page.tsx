import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { PageHeader } from "@/components/shared/states";
import { AdminActionButton, AdminForm } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { isAppError } from "@/lib/errors";
import { plansForControls } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { formatBDT, formatDate, formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { getOrganizationDetail } from "@/features/admin/service";
import { adjustWalletAction, resetCustomerPricingAction, saveCustomerPricingAction, sendPasswordResetAction, setOrgStatusAction, updateOrgControlsAction } from "@/features/admin/actions";
import { customerExtras, customerPricing, customerUsage, providerBalance, superAdminAvailable } from "@/features/admin/super-admin";
import { UsageChart } from "@/components/dashboard/charts";

export const metadata = { title: "Customer" };

export default async function AdminCustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const session = await requirePlatform("admin:customers:read");
  const { id } = await params;
  let d;
  try {
    d = await laravelPage(() => getOrganizationDetail(id));
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { org } = d;
  const plans = await laravelPage(() => plansForControls(platformCan(session.user.platformRole, "admin:pricing:manage")));
  const canManage = platformCan(session.user.platformRole, "admin:customers:manage");
  const canAdjust = platformCan(session.user.platformRole, "admin:wallet:adjust");
  const extras = superAdminAvailable() ? await laravelPage(() => customerExtras(id)) : null;
  const usage = superAdminAvailable() ? await laravelPage(() => customerUsage(id, { range: "30d" })) : null;
  const pricing = superAdminAvailable() ? await laravelPage(() => customerPricing(id)) : null;
  const canPrice = platformCan(session.user.platformRole, "admin:pricing:customer");
  const gateway = canPrice && superAdminAvailable() ? await laravelPage(() => providerBalance()) : null;
  // One key per rendered form: a double submit or retry applies the adjustment once.
  const adjustmentKey = `adj_${randomUUID().replaceAll("-", "")}`;

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
              <AdminActionButton action={setOrgStatusAction.bind(null, org.id, "ACTIVE")} label="Reactivate account" reason="required" reasonLabel="Reason (recorded in the audit log)" size="md" variant="primary" confirmDescription="Sending and API keys work again immediately. Paused campaigns stay paused until the customer resumes them." />
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
            {canAdjust && (
              <AdminForm action={adjustWalletAction} submitLabel="Apply adjustment">
                <input type="hidden" name="orgId" value={org.id} />
                <input type="hidden" name="idempotencyKey" value={adjustmentKey} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Direction">
                    <NativeSelect name="direction" defaultValue="CREDIT">
                      <option value="CREDIT">Credit</option>
                      <option value="DEBIT">Debit</option>
                    </NativeSelect>
                  </Field>
                  <Field label="Amount (BDT)" required>
                    <Input name="amount" inputMode="decimal" pattern="\d{1,8}(\.\d{1,2})?" placeholder="0.00" autoComplete="off" />
                  </Field>
                </div>
                <Field label="Reason" required hint="Visible in the customer's transaction history. Debits never take a wallet below zero.">
                  <Textarea name="note" rows={2} maxLength={300} />
                </Field>
                <Field label="Your current password" required>
                  <PasswordInput name="currentPassword" autoComplete="current-password" maxLength={200} />
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
                    {pricing?.custom && org.pricingPlanId && <option value={org.pricingPlanId}>{pricing.planName}</option>}
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
                {extras && (extras.verification.get(m.userId)?.emailVerified ? <Badge tone="success">email verified</Badge> : <Badge tone="warning">email unverified</Badge>)}
                <Badge tone="primary" className="ml-auto">
                  {m.role.name}
                </Badge>
                <span className="w-32 text-right text-xs text-muted-foreground">{m.user.lastLoginAt ? formatRelative(m.user.lastLoginAt) : "never"}</span>
                {extras && canManage && m.user.status === "ACTIVE" && (
                  <AdminActionButton
                    action={sendPasswordResetAction.bind(null, m.userId)}
                    label="Send reset link"
                    variant="ghost"
                    reason="optional"
                    reasonLabel="Reason (audit log)"
                    confirmTitle={`E-mail a password-reset link to ${m.user.email}?`}
                    confirmDescription="The link goes only to the account's own address. You never see the password or the link."
                  />
                )}
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

      {pricing && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>
              SMS prices {pricing.custom ? <Badge tone="accent">Custom</Badge> : <Badge tone="outline">{pricing.planName}</Badge>}
            </CardTitle>
            <CardDescription>
              {formatBDT(pricing.maskingRate, "en", { decimals: 4 })} masking · {formatBDT(pricing.nonMaskingRate, "en", { decimals: 4 })} non-masking, per SMS segment.
              {gateway?.maskingRate && ` Your gateway charges ${formatBDT(gateway.maskingRate, "en", { decimals: 4 })} and ${formatBDT(gateway.nonMaskingRate ?? "0", "en", { decimals: 4 })}.`}
            </CardDescription>
          </CardHeader>
          {canPrice && (
            <CardContent className="grid gap-8 lg:grid-cols-2">
              <AdminForm action={saveCustomerPricingAction} className="grid gap-3 sm:grid-cols-2" submitLabel="Save prices">
                <input type="hidden" name="orgId" value={org.id} />
                <Field label="Masking price (BDT)" required>
                  <Input name="maskingRate" inputMode="decimal" defaultValue={pricing.maskingRate} />
                </Field>
                <Field label="Non-masking price (BDT)" required>
                  <Input name="nonMaskingRate" inputMode="decimal" defaultValue={pricing.nonMaskingRate} />
                </Field>
                <Field label="Reason" required hint="Kept in the audit log.">
                  <Input name="reason" maxLength={500} />
                </Field>
                <Field label="Your current password" required>
                  <PasswordInput name="currentPassword" autoComplete="current-password" maxLength={200} />
                </Field>
              </AdminForm>
              {pricing.custom && (
                <AdminForm action={resetCustomerPricingAction} className="grid gap-3 sm:grid-cols-2" submitLabel="Remove custom prices">
                  <input type="hidden" name="orgId" value={org.id} />
                  <p className="text-sm text-muted-foreground sm:col-span-2">Moves this customer back to the default plan. You can then choose another plan in the account controls.</p>
                  <Field label="Reason" required>
                    <Input name="reason" maxLength={500} />
                  </Field>
                  <Field label="Your current password" required>
                    <PasswordInput name="currentPassword" autoComplete="off" maxLength={200} />
                  </Field>
                </AdminForm>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {usage && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Usage in the last 30 days</CardTitle>
            <CardDescription>
              {formatNumber(usage.totals.messages)} messages, {formatNumber(usage.totals.segments)} segments, {formatBDT(usage.totals.charged)} charged.{" "}
              <Link href={`/admin/usage?q=${encodeURIComponent(org.name)}`} className="font-medium text-primary hover:underline">
                Compare with other customers
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsageChart data={usage.series} />
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {Object.entries({ ...usage.bySource, ...usage.byType }).map(([k, n]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-muted-foreground">{k === "API" ? k : k.charAt(0) + k.slice(1).toLowerCase()}</dt>
                  <dd className="tabular">{formatNumber(n)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}

      {extras && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader>
              <CardTitle>Messages in the last 30 days</CardTitle>
              <CardDescription>By delivery status, with the amount charged.</CardDescription>
            </CardHeader>
            <ul className="divide-y divide-border text-sm">
              {Object.entries(extras.statusTotals30).map(([status, t]) => (
                <li key={status} className="flex items-center gap-2 px-5 py-2.5">
                  <StatusBadge status={status} />
                  <span className="ml-auto tabular">{formatNumber(t.count)}</span>
                  <span className="w-28 text-right tabular text-muted-foreground">{formatBDT(t.cost)}</span>
                </li>
              ))}
              {Object.keys(extras.statusTotals30).length === 0 && <li className="px-5 py-4 text-muted-foreground">No messages</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>API keys</CardTitle>
              <CardDescription>Status only; keys are stored as hashes and never shown.</CardDescription>
            </CardHeader>
            <ul className="divide-y divide-border text-sm">
              {extras.apiKeys.map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                  <span className="font-medium">{k.name}</span>
                  <code className="font-mono text-xs text-muted-foreground">{k.prefix}…</code>
                  <StatusBadge status={k.status} className="ml-auto" />
                  <span className="w-32 text-right text-xs text-muted-foreground">{k.lastUsedAt ? `used ${formatRelative(k.lastUsedAt)}` : "never used"}</span>
                </li>
              ))}
              {extras.apiKeys.length === 0 && <li className="px-5 py-4 text-muted-foreground">None</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Support history</CardTitle>
            </CardHeader>
            <ul className="divide-y divide-border text-sm">
              {extras.tickets.map((t) => (
                <li key={t.id} className="flex items-center gap-2 px-5 py-2.5">
                  <Link href={`/admin/support/${t.id}`} className="min-w-0 flex-1 truncate hover:text-primary">
                    #{t.number} {t.subject}
                  </Link>
                  <StatusBadge status={t.status} />
                  <span className="w-24 text-right text-xs text-muted-foreground">{t.createdAt ? formatDate(t.createdAt) : ""}</span>
                </li>
              ))}
              {extras.tickets.length === 0 && <li className="px-5 py-4 text-muted-foreground">None</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Plan history</CardTitle>
              <CardDescription>Prepaid account: plans set per-SMS rates; there are no recurring subscriptions.</CardDescription>
            </CardHeader>
            <ul className="divide-y divide-border text-sm">
              {extras.planHistory.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-2 px-5 py-2.5">
                  <span>Plan changed by {a.actor?.name ?? a.actorType.toLowerCase()}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{a.createdAt ? formatDateTime(a.createdAt) : ""}</span>
                </li>
              ))}
              {extras.planHistory.length === 0 && <li className="px-5 py-4 text-muted-foreground">No plan changes recorded</li>}
            </ul>
          </Card>
        </div>
      )}

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
