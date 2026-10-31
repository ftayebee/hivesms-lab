import Link from "next/link";
import { ArrowRight, CheckCheck, CircleAlert, Clock, Megaphone, Percent, Send, Wallet, Receipt, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert, Progress } from "@/components/ui/misc";
import { StatsCard } from "@/components/dashboard/stats-card";
import { StatusBreakdown } from "@/components/dashboard/status-breakdown";
import { CampaignPerformanceChart, SpendChart, UsageChart } from "@/components/dashboard/charts";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { getT } from "@/i18n/server";
import { formatBDT, formatDate, formatDateTime, formatNumber, formatPercent } from "@/lib/format";
import { parseRange } from "@/features/reports/range";
import { loadDashboard } from "@/features/reports/dashboard";
import { laravelPage } from "@/lib/laravel-api";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const sp = await searchParams;
  const { ctx, session, allowed } = await tenantWithPermission("dashboard:read");
  if (!allowed) return <PermissionDenied permission="dashboard:read" />;
  const { t, locale } = await getT();
  const range = parseRange(sp);
  const canBilling = can(ctx, "billing:read");

  const { totals, daily, spend, balance, recent, perf, txns } = await laravelPage(() => loadDashboard(ctx, range, canBilling));
  const firstName = session.user.name.split(" ")[0];
  const noData = totals.total === 0;

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={`Activity for ${range.label.toLowerCase()} · Asia/Dhaka time`}
        actions={
          <>
            {can(ctx, "sms:send") && (
              <Button asChild>
                <Link href="/dashboard/send">
                  <Send /> Send SMS
                </Link>
              </Button>
            )}
            {can(ctx, "campaigns:write") && (
              <Button asChild variant="secondary">
                <Link href="/dashboard/campaigns/new">
                  <Megaphone /> New campaign
                </Link>
              </Button>
            )}
          </>
        }
      />
      {sp.welcome === "1" && (
        <Alert tone="success" className="mb-6" title="Your account is ready">
          Next: verify your email, add balance in Wallet, and send a test message to your own number.
        </Alert>
      )}
      {sp.verified === "1" && (
        <Alert tone="success" className="mb-6">
          Email verified. Thank you.
        </Alert>
      )}
      {balance && balance.balance.lt(balance.lowBalanceThreshold) && (
        <Alert
          tone="warning"
          className="mb-6"
          title="Low balance"
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href="/dashboard/wallet">Add balance</Link>
            </Button>
          }
        >
          Your balance is {formatBDT(balance.balance.toString(), locale)}. Messages stop sending when it runs out.
        </Alert>
      )}

      <div className="mb-6">
        <DateRangeFilter current={range.key} />
      </div>

      {balance && (
        <section aria-label="Balance and SMS quantity" className="mb-4 grid gap-4 md:grid-cols-2">
          <StatsCard
            label="Current balance"
            value={formatBDT(balance.balance.toString(), locale)}
            icon={Wallet}
            tone="accent"
            hint={`${balance.planName} plan · ${formatBDT(balance.rate.toString(), locale)} per non-masking SMS`}
          />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>SMS Quantity</CardTitle>
              <CardDescription>What your balance can send, counting single-part English messages. Bangla and long messages use more.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 divide-x divide-border rounded-md border border-border text-center">
                <div className="p-3">
                  <dt>
                    <Badge className="bg-destructive text-destructive-foreground">Masking</Badge>
                  </dt>
                  <dd className="mt-2 text-xl font-semibold tabular">{formatNumber(balance.maskingCredits, locale)}</dd>
                </div>
                <div className="p-3">
                  <dt>
                    <Badge className="bg-primary text-primary-foreground">Non-Mask</Badge>
                  </dt>
                  <dd className="mt-2 text-xl font-semibold tabular">{formatNumber(balance.credits, locale)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </section>
      )}

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Total SMS sent" value={formatNumber(totals.total, locale)} icon={Send} hint={`${formatNumber(totals.segments, locale)} segments`} />
        <StatsCard label="Delivered" value={formatNumber(totals.delivered, locale)} icon={CheckCheck} tone="success" hint="Final delivery reports" />
        <StatsCard label="Failed" value={formatNumber(totals.failed, locale)} icon={CircleAlert} tone="danger" hint="Failed, rejected or expired" />
        <StatsCard label="Pending" value={formatNumber(totals.pending, locale)} icon={Clock} tone="primary" hint="Queued or awaiting report" />
        <StatsCard label="Delivery rate" value={totals.deliveryRate === null ? "-" : formatPercent(totals.deliveryRate, locale)} icon={Percent} tone="success" hint="Delivered of final outcomes" />
        {spend && <StatsCard label="Spending" value={formatBDT(spend.net.toString(), locale)} icon={Coins} tone="warning" hint={`${formatBDT(spend.refunded.toString(), locale)} refunded`} />}
        {!balance && <StatsCard label="Campaigns" value={formatNumber(recent.length, locale)} icon={Megaphone} hint="Recent" />}
      </section>

      {noData ? (
        <Card className="mt-6">
          <EmptyState
            icon={Send}
            title="No messages in this period"
            description="Send a message or launch a campaign, and delivery statistics will appear here."
            action={
              can(ctx, "sms:send") ? (
                <Button asChild>
                  <Link href="/dashboard/send">Send your first SMS</Link>
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="mt-6 grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>SMS usage over time</CardTitle>
              <CardDescription>Messages created per day, by current delivery status</CardDescription>
            </CardHeader>
            <CardContent>
              <UsageChart data={daily} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delivery status</CardTitle>
              <CardDescription>{formatNumber(totals.total, locale)} messages</CardDescription>
            </CardHeader>
            <CardContent>
              <StatusBreakdown delivered={totals.delivered} pending={totals.pending} failed={totals.failed} />
              <Button asChild variant="link" className="mt-4">
                <Link href={`/dashboard/reports?range=${range.key}`}>
                  Open reports <ArrowRight />
                </Link>
              </Button>
            </CardContent>
          </Card>
          {spend && (
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Spending</CardTitle>
                <CardDescription>Message charges per day, after refunds</CardDescription>
              </CardHeader>
              <CardContent>
                <SpendChart data={daily} />
              </CardContent>
            </Card>
          )}
          <Card className={spend ? "" : "xl:col-span-3"}>
            <CardHeader>
              <CardTitle>Campaign performance</CardTitle>
              <CardDescription>Campaigns started in this period</CardDescription>
            </CardHeader>
            <CardContent>
              {perf.length ? (
                <CampaignPerformanceChart
                  data={perf.map((c) => ({ name: c.name, delivered: c.deliveredCount, failed: c.failedCount, pending: Math.max(0, c.submittedCount - c.deliveredCount - c.failedCount) }))}
                />
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">No campaigns started in this period.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent campaigns</CardTitle>
            <Link href="/dashboard/campaigns" className="text-sm font-medium text-primary hover:underline">
              {t.common.viewAll}
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {recent.length ? (
              <ul className="divide-y divide-border">
                {recent.map((c) => {
                  const total = Math.max(1, c.recipientCount);
                  return (
                    <li key={c.id} className="px-5 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <Link href={`/dashboard/campaigns/${c.id}`} className="truncate text-sm font-medium hover:text-primary">
                          {c.name}
                        </Link>
                        <StatusBadge status={c.status} label={t.status[c.status as keyof typeof t.status]} />
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <Progress value={c.deliveredCount} max={total} label={`${c.name} delivered`} tone="success" className="flex-1" />
                        <span className="w-28 text-right text-xs text-muted-foreground tabular">
                          {formatNumber(c.deliveredCount, locale)} / {formatNumber(c.recipientCount, locale)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {c.scheduledAt && c.status === "SCHEDULED" ? `Scheduled ${formatDateTime(c.scheduledAt, locale)}` : `Created ${formatDate(c.createdAt, locale)}`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={Megaphone} title="No campaigns yet" description="Create a campaign to message a contact group." className="py-8" />
            )}
          </CardContent>
        </Card>
        {canBilling && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Recent transactions</CardTitle>
              <Link href="/dashboard/transactions" className="text-sm font-medium text-primary hover:underline">
                {t.common.viewAll}
              </Link>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {txns.length ? (
                <ul className="divide-y divide-border">
                  {txns.map((tx) => (
                    <li key={tx.id} className="flex items-center gap-3 px-5 py-3">
                      <span className={`grid size-8 shrink-0 place-items-center rounded-full ${tx.type === "CREDIT" ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
                        <Receipt className="size-4" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{tx.description}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(tx.createdAt, locale)}</p>
                      </div>
                      <span className={`text-sm font-medium tabular ${tx.type === "CREDIT" ? "text-success" : ""}`}>
                        {tx.type === "CREDIT" ? "+" : "−"}
                        {formatBDT(tx.amount.toString(), locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Wallet} title="No transactions yet" description="Top-ups, charges and refunds will appear here." className="py-8" />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
