import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { Pagination, parsePage } from "@/components/ui/table";
import { StatsCard } from "@/components/dashboard/stats-card";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { formatBDT, formatDateTime } from "@/lib/format";
import { parseRange } from "@/features/reports/range";
import { listTransactions, TX_PAGE_SIZE, txFilterSchema } from "@/features/wallet/service";
import { cn } from "@/lib/utils";

export const metadata = { title: "Transactions" };

const REASONS = { TOPUP: "Top-up", BONUS: "Bonus", SMS_CHARGE: "SMS charge", REFUND: "Refund", ADJUSTMENT: "Adjustment", SENDER_ID_FEE: "Sender ID fee" } as const;

function refLink(type: string | null, id: string | null) {
  if (!type || !id) return null;
  if (type === "campaign") return `/dashboard/campaigns/${id}`;
  if (type === "payment") return `/dashboard/wallet/payments/${id}`;
  if (type === "message") return `/dashboard/reports/messages/${id}`;
  return null;
}

export default async function TransactionsPage({ searchParams }: PageProps<"/dashboard/transactions">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("billing:read");
  if (!allowed) return <PermissionDenied permission="billing:read" />;
  const range = parseRange(sp, "90d");
  const f = txFilterSchema.parse(sp);
  const page = parsePage(sp.page);
  const { rows, total, credit, debit } = await listTransactions(ctx, range, f, page);
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => typeof v === "string" && k !== "page") as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every top-up, charge and refund on your wallet."
        actions={
          <Button asChild variant="secondary">
            <a href={`/api/v1/app/transactions/export${qs ? `?${qs}` : ""}`}>
              <Download /> Export CSV
            </a>
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <DateRangeFilter current={range.key} defaultKey="90d" />
        <form method="get" className="flex gap-2">
          {typeof sp.range === "string" && <input type="hidden" name="range" value={sp.range} />}
          <label htmlFor="tx-reason" className="sr-only">
            Type
          </label>
          <NativeSelect id="tx-reason" name="reason" defaultValue={f.reason ?? ""} className="w-44">
            <option value="">All types</option>
            {Object.entries(REASONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </div>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatsCard label="Credits" value={formatBDT(credit.toString())} tone="success" hint={range.label} />
        <StatsCard label="Debits" value={formatBDT(debit.toString())} tone="warning" hint={range.label} />
        <StatsCard label="Net" value={formatBDT(credit.minus(debit).toString())} tone="primary" hint={range.label} className="col-span-2 md:col-span-1" />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Receipt} title="No transactions in this period" />
        ) : (
          <>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Wallet transactions</caption>
                <thead className="bg-surface/70">
                  <tr>
                    {["Date", "Type", "Description", "Amount", "Balance after"].map((h, i) => (
                      <th key={h} scope="col" className={cn("h-10 whitespace-nowrap border-b border-border px-4 text-left text-xs font-medium text-muted-foreground", i >= 3 && "text-right")}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const href = refLink(r.referenceType, r.referenceId);
                    return (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{formatDateTime(r.createdAt)}</td>
                        <td className="px-4 py-2.5">
                          <Badge tone={r.type === "CREDIT" ? "success" : "neutral"}>{REASONS[r.reason]}</Badge>
                        </td>
                        <td className="max-w-md truncate px-4 py-2.5">
                          {href ? (
                            <Link href={href} className="hover:text-primary">
                              {r.description}
                            </Link>
                          ) : (
                            r.description
                          )}
                        </td>
                        <td className={cn("whitespace-nowrap px-4 py-2.5 text-right font-medium tabular", r.type === "CREDIT" && "text-success")}>
                          {r.type === "CREDIT" ? "+" : "−"}
                          {formatBDT(r.amount.toString())}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-right tabular text-muted-foreground">{formatBDT(r.balanceAfter.toString())}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={TX_PAGE_SIZE} total={total} searchParams={sp} basePath="/dashboard/transactions" />
          </>
        )}
      </Card>
    </>
  );
}
