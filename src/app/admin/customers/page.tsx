import Link from "next/link";
import { Building2, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { formatBDT, formatDate, formatNumber } from "@/lib/format";
import { ADMIN_PAGE, listOrganizations } from "@/features/admin/service";
import { plansForControls } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";

export const metadata = { title: "Customers" };

export default async function AdminCustomersPage({ searchParams }: PageProps<"/admin/customers">) {
  const session = await requirePlatform("admin:customers:read");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const status = sp.status === "ACTIVE" || sp.status === "SUSPENDED" ? sp.status : undefined;
  const page = parsePage(sp.page);
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  // The plan list needs the pricing permission on the Laravel path; support staff filter without it.
  const plans = await laravelPage(() => plansForControls(platformCan(session.user.platformRole, "admin:pricing:manage")));
  const planId = typeof sp.plan === "string" && (sp.plan === "none" || plans.some((p) => p.id === sp.plan)) ? sp.plan : undefined;
  const from = day(sp.from);
  const to = day(sp.to);
  const review = sp.review === "1";
  const { rows, total } = await laravelPage(() => listOrganizations({ q: q || undefined, status, planId, from, to, review, page }));
  return (
    <>
      <PageHeader title="Customers" description={`${formatNumber(total)} organizations`} />
      <Card>
        <form method="get" className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row" role="search">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="aq" className="sr-only">
              Search
            </label>
            <Input id="aq" name="q" defaultValue={q} placeholder="Organization, ID, member e-mail, name or phone" className="pl-9" />
          </div>
          <label htmlFor="ap" className="sr-only">
            Plan
          </label>
          <NativeSelect id="ap" name="plan" defaultValue={planId ?? ""} className="sm:w-40">
            <option value="">All plans</option>
            <option value="none">Default plan</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
          <label className="sr-only" htmlFor="afrom">
            Registered from
          </label>
          <Input id="afrom" type="date" name="from" defaultValue={from} className="sm:w-40" title="Registered from" />
          <label className="sr-only" htmlFor="ato">
            Registered until
          </label>
          <Input id="ato" type="date" name="to" defaultValue={to} className="sm:w-40" title="Registered until" />
          <label className="flex items-center gap-2 whitespace-nowrap text-sm">
            <input type="checkbox" name="review" value="1" defaultChecked={review} className="size-4 accent-[var(--primary)]" />
            Under review
          </label>
          <label htmlFor="as" className="sr-only">
            Status
          </label>
          <NativeSelect id="as" name="status" defaultValue={status ?? ""} className="sm:w-40">
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <DataTable
          caption="Organizations"
          rows={rows}
          getKey={(o) => o.id}
          empty={<EmptyState icon={Building2} title="No organizations found" />}
          columns={[
            {
              key: "name",
              header: "Organization",
              mobile: "title",
              cell: (o) => (
                <Link href={`/admin/customers/${o.id}`} className="font-medium hover:text-primary">
                  {o.name}
                </Link>
              ),
            },
            { key: "status", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
            { key: "plan", header: "Plan", cell: (o) => o.pricingPlan?.name ?? "Default" },
            { key: "balance", header: "Balance", align: "right", cell: (o) => formatBDT(o.wallet?.balance.toString() ?? "0") },
            { key: "members", header: "Members", align: "right", cell: (o) => o._count.members },
            { key: "messages", header: "Messages", align: "right", cell: (o) => formatNumber(o._count.messages) },
            { key: "limits", header: "Daily limit", align: "right", cell: (o) => formatNumber(o.dailySendLimit) },
            { key: "created", header: "Created", cell: (o) => <span className="whitespace-nowrap text-muted-foreground">{formatDate(o.createdAt)}</span> },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={ADMIN_PAGE} total={total} searchParams={sp} basePath="/admin/customers" />}
      </Card>
    </>
  );
}
