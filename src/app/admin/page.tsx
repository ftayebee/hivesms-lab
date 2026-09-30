import Link from "next/link";
import { Activity, BadgeCheck, Building2, CircleAlert, Coins, CreditCard, Flag, LifeBuoy, Megaphone, Send, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/dashboard/stats-card";
import { SpendChart, UsageChart } from "@/components/dashboard/charts";
import { PageHeader } from "@/components/shared/states";
import { Alert } from "@/components/ui/misc";
import { formatBDT, formatNumber } from "@/lib/format";
import { getAdminOverview } from "@/features/admin/overview";
import { getSmsProviderSettings } from "@/services/settings";

export const metadata = { title: "Overview" };

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  const [o, provider] = await Promise.all([getAdminOverview(), getSmsProviderSettings()]);
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
      <PageHeader title="Platform overview" description={`SMS provider: ${provider.provider === "mock" ? "mock (simulation, no real SMS)" : provider.provider}`} />
      {sp.denied === "1" && (
        <Alert tone="warning" className="mb-6">
          Your staff role does not include access to that page.
        </Alert>
      )}
      <section aria-label="Key metrics" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Registered users" value={formatNumber(o.users)} icon={Users} hint={`${formatNumber(o.activeUsers)} active in 30 days`} />
        <StatsCard label="Organizations" value={formatNumber(o.orgs)} icon={Building2} hint={`${formatNumber(o.suspendedOrgs)} suspended`} />
        <StatsCard label="SMS volume" value={formatNumber(o.sms30)} icon={Send} tone="primary" hint={`${formatNumber(o.smsToday)} today · 30 days`} />
        <StatsCard label="Revenue (30 days)" value={formatBDT(o.revenue30.toString())} icon={Coins} tone="success" hint={`${formatBDT(o.collected30.toString())} collected incl. VAT`} />
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
            <CardTitle>Revenue</CardTitle>
            <CardDescription>Completed top-ups per day, excluding VAT</CardDescription>
          </CardHeader>
          <CardContent>
            <SpendChart data={o.series} height={200} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
