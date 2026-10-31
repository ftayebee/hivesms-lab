import Link from "next/link";
import { Activity, BadgeCheck, Building2, CircleAlert, Coins, CreditCard, Flag, LifeBuoy, Megaphone, Send, Users, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/dashboard/stats-card";
import { SpendChart, UsageChart } from "@/components/dashboard/charts";
import { PageHeader } from "@/components/shared/states";
import { Alert } from "@/components/ui/misc";

import { adminOverviewPage } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { RangeFilter, rangeParams } from "@/components/admin/range-filter";
import { SmsQuantity } from "@/components/dashboard/sms-quantity";
import { parseRange, platformDashboard, providerBalance, superAdminAvailable, type PlatformDashboard, type RangeQuery } from "@/features/admin/super-admin";
import { formatBDT, formatDateTime, formatNumber } from "@/lib/format";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  const session = await requirePlatform("admin:access");
  const { o, providerKey } = await laravelPage(() => adminOverviewPage());
  const range = parseRange(sp);
  const dash = superAdminAvailable() ? await laravelPage(() => platformDashboard(range)) : null;
  const gateway = superAdminAvailable() && platformCan(session.user.platformRole, "admin:finance:read") ? await laravelPage(() => providerBalance()) : null;
  const queues = [
    { href: "/admin/campaigns?status=PENDING_REVIEW", label: "Campaigns awaiting review", n: o.reviewCampaigns, icon: Megaphone },
    { href: "/admin/sender-ids?status=PENDING", label: "Sender IDs awaiting review", n: o.pendingSenders, icon: BadgeCheck },
    { href: "/admin/payments?status=AWAITING_VERIFICATION", label: "Payments to verify", n: o.pendingPayments, icon: CreditCard },
    { href: "/admin/support", label: "Open tickets", n: o.openTickets, icon: LifeBuoy },
    { href: "/admin/abuse", label: "New abuse reports", n: o.newAbuse, icon: Flag },
    { href: "/admin/abuse#leads", label: "New sales leads", n: o.newLeads, icon: Users },
  ];
  return (
    <>
      <PageHeader title="Platform overview" description={`SMS provider: ${providerKey === "mock" ? "mock (simulation, no real SMS)" : providerKey}`} />
      {sp.denied === "1" && (
        <Alert tone="warning" className="mb-6">
          Your staff role does not include access to that page.
        </Alert>
      )}
      {gateway && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>SMS gateway balance</CardTitle>
            <CardDescription>
              {gateway.available
                ? `What ${gateway.provider} can still send, counting single-part messages. Updated every minute.`
                : `Couldn't read the balance from ${gateway.provider}. Check the API key, or the provider may not offer this.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <StatsCard
              label="Current balance"
              value={gateway.balance === null ? "-" : formatBDT(gateway.balance)}
              icon={Wallet}
              tone="accent"
              hint={
                gateway.maskingRate
                  ? `${formatBDT(gateway.maskingRate)} masking · ${formatBDT(gateway.nonMaskingRate ?? "0")} non-masking, from ${gateway.rateSource === "costs_settings" ? "Costs & margins" : "the provider's price list"}`
                  : undefined
              }
            />
            <div>
              <p className="mb-2 text-sm font-medium">SMS Quantity</p>
              <SmsQuantity
                masking={gateway.maskingCount === null ? null : formatNumber(gateway.maskingCount)}
                nonMasking={gateway.nonMaskingCount === null ? null : formatNumber(gateway.nonMaskingCount)}
              />
            </div>
          </CardContent>
        </Card>
      )}
      {dash && <PlatformSection d={dash} range={range} canFinance={platformCan(session.user.platformRole, "admin:finance:read")} />}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Registered users" value={formatNumber(o.users)} icon={Users} hint={`${formatNumber(o.activeUsers)} active in 30 days`} />
        <StatsCard label="Organizations" value={formatNumber(o.orgs)} icon={Building2} hint={`${formatNumber(o.suspendedOrgs)} suspended`} />
        <StatsCard label="SMS volume" value={formatNumber(o.sms30)} icon={Send} tone="primary" hint={`${formatNumber(o.smsToday)} today · 30 days`} />
        <StatsCard label="Payment receipts (30 days)" value={formatBDT(o.revenue30.toString())} icon={Coins} tone="success" hint={`Confirmed top-ups excl. VAT · ${formatBDT(o.collected30.toString())} incl. VAT`} />
        <StatsCard label="Pending sender IDs" value={formatNumber(o.pendingSenders)} icon={BadgeCheck} tone="warning" />
        <StatsCard label="Pending payments" value={formatNumber(o.pendingPayments)} icon={CreditCard} tone="warning" />
        <StatsCard label="Failed messages (24h)" value={formatNumber(o.failed24)} icon={CircleAlert} tone="danger" />
        <StatsCard label="API requests (24h)" value={formatNumber(o.api24)} icon={Activity} tone="accent" />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Platform SMS volume</CardTitle>
            <CardDescription>Last 30 days, all customers</CardDescription>
          </CardHeader>
          <CardContent>
            <UsageChart data={o.series} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Work queues</CardTitle>
          </CardHeader>
          <ul className="divide-y divide-border">
            {queues.map((q) => (
              <li key={q.href}>
                <Link href={q.href} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface/60">
                  <q.icon className="size-4 text-muted-foreground" aria-hidden />
                  <span className="flex-1">{q.label}</span>
                  <span className={q.n ? "rounded-full bg-warning-soft px-2 text-xs font-semibold text-warning tabular" : "text-xs text-muted-foreground"}>{q.n}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>Payment receipts</CardTitle>
            <CardDescription>Confirmed top-ups per day, excluding VAT (cash received, not usage revenue)</CardDescription>
          </CardHeader>
          <CardContent>
            <SpendChart data={o.series} height={200} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Platform-wide dashboard (Laravel admin API): real aggregates, liability kept apart from receipts and revenue. */
function PlatformSection({ d, range, canFinance }: { d: PlatformDashboard; range: RangeQuery; canFinance: boolean }) {
  const c = d.customers;
  const f = d.finance;
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Platform</CardTitle>
        <CardDescription>{d.range.label} · organizations, SMS and money from database aggregates</CardDescription>
      </CardHeader>
      <RangeFilter value={range} />
      <CardContent className="space-y-6 pt-4">
        <section aria-label="Customers" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatsCard label="Organizations" value={formatNumber(c.total)} icon={Building2} hint={`${formatNumber(c.newInRange)} new in period`} />
          <StatsCard label="Active" value={formatNumber(c.active)} tone="success" />
          <StatsCard label="Suspended" value={formatNumber(c.suspended)} tone="danger" />
          <StatsCard label="Pending verification" value={formatNumber(c.pending)} tone="warning" hint="No member has verified an e-mail" />
          <StatsCard label="Campaign review required" value={formatNumber(c.underReview)} tone="accent" hint="Account flag: campaigns wait for staff approval" />
        </section>
        <section aria-label="SMS" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatsCard label="SMS today" value={formatNumber(d.sms.today.total)} icon={Send} />
          <StatsCard label="SMS this month" value={formatNumber(d.sms.month.total)} icon={Send} />
          <StatsCard label="SMS in period" value={formatNumber(d.sms.range.total)} icon={Send} hint={`${formatNumber(d.sms.range.delivered)} delivered · ${formatNumber(d.sms.range.failed)} failed · ${formatNumber(d.sms.range.pending)} pending`} />
          <StatsCard label="Staff accounts" value={formatNumber(c.activeStaff)} icon={Users} hint={`${formatNumber(c.customerUsers)} customer users`} />
        </section>
        {f && canFinance && (
          <section aria-label="Money" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatsCard label="Wallet liability (now)" value={formatBDT(f.liability.balance)} icon={CreditCard} tone="accent" hint="Prepaid balances owed as SMS — not revenue" />
            <StatsCard label="Payment receipts" value={formatBDT(f.receipts.net)} icon={Coins} tone="success" hint={`${formatBDT(f.receipts.gross)} incl. VAT`} />
            <StatsCard label="Refunds" value={formatBDT(f.paymentRefunds.amount)} tone="warning" hint={`${formatBDT(f.usage.smsRefunds)} failed-SMS refunds to wallets`} />
            <StatsCard label="Usage revenue" value={formatBDT(f.usage.revenue)} tone="primary" hint={f.providerCost.estimatedMargin !== null ? `Est. margin ${formatBDT(f.providerCost.estimatedMargin)} (estimate)` : "Provider costs not configured"} />
          </section>
        )}
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h3 className="mb-2 text-sm font-medium">Plan distribution</h3>
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {d.plans.map((p) => (
                <li key={p.id ?? "default"} className="flex items-center gap-2 px-4 py-2">
                  <Link href={`/admin/customers?plan=${p.id ?? "none"}`} className="flex-1 hover:text-primary">
                    {p.name}
                  </Link>
                  {!p.active && <span className="text-xs text-muted-foreground">inactive</span>}
                  <span className="tabular">{formatNumber(p.organizations)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Subscriptions: {d.subscriptions.note}</p>
          </div>
          {d.recentPrivilegedActions && (
            <div>
              <h3 className="mb-2 text-sm font-medium">Recent privileged actions</h3>
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {d.recentPrivilegedActions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <code className="font-mono text-xs">{a.action}</code>
                    <span className="text-muted-foreground">{a.actor?.name ?? a.actorType.toLowerCase()}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{a.createdAt ? formatDateTime(a.createdAt) : ""}</span>
                  </li>
                ))}
                {d.recentPrivilegedActions.length === 0 && <li className="px-4 py-3 text-muted-foreground">None yet</li>}
              </ul>
              <Link href={`/admin/finance?${rangeParams(range)}`} className="mt-2 inline-block text-xs text-primary hover:underline">
                Finance details →
              </Link>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
