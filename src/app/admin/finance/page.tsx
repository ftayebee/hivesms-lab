import Link from "next/link";
import { Banknote, Coins, Download, Landmark, ReceiptText, RotateCcw, Scale, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { RangeFilter, rangeParams } from "@/components/admin/range-filter";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { laravelPage } from "@/lib/laravel-api";
import { formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { financeSummary, ledger, parseRange, superAdminAvailable } from "@/features/admin/super-admin";

export const metadata = { title: "Finance" };

const REASONS = ["TOPUP", "BONUS", "SMS_CHARGE", "REFUND", "ADJUSTMENT", "SENDER_ID_FEE"];

export default async function AdminFinancePage({ searchParams }: PageProps<"/admin/finance">) {
  const session = await requirePlatform("admin:finance:read");
  const sp = await searchParams;
  if (!superAdminAvailable()) {
    return (
      <>
        <PageHeader title="Finance" />
        <Alert tone="info" title="Needs the Laravel admin API">
          Finance reports are computed by the Laravel API, the single source for money rules. They appear once LARAVEL_FEATURES includes <code>admin</code>.
        </Alert>
      </>
    );
  }
  const range = parseRange(sp);
  const page = parsePage(sp.page);
  const reason = REASONS.find((r) => r === sp.reason);
  const type = sp.type === "CREDIT" || sp.type === "DEBIT" ? sp.type : undefined;
  const organizationId = typeof sp.org === "string" && /^[0-9a-f-]{36}$/i.test(sp.org) ? sp.org : undefined;
  const [s, tx] = await Promise.all([laravelPage(() => financeSummary(range)), laravelPage(() => ledger({ ...range, reason, type, organizationId, page }))]);
  const canExport = platformCan(session.user.platformRole, "admin:reports:export");
  const qs = rangeParams(range);
  const pc = s.providerCost;

  return (
    <>
      <PageHeader
        title="Finance"
        description={`${s.range.label} · amounts in BDT · from the immutable wallet ledger and confirmed payments`}
        actions={
          canExport ? (
            <div className="flex flex-wrap gap-2">
              {(["transactions", "payments", "margins"] as const).map((k) => (
                <a key={k} href={`/api/v1/admin/exports/${k}?${qs}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">
                  <Download className="size-4" aria-hidden /> {k} CSV
                </a>
              ))}
            </div>
          ) : undefined
        }
      />
      <Card className="mb-6">
        <RangeFilter value={range} />
      </Card>

      <section aria-label="Money position" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard label="Customer wallet liability" value={formatBDT(s.liability.balance)} icon={Wallet} tone="accent" hint={`Owed as SMS to ${formatNumber(s.liability.funded)} funded wallets · now, not revenue`} />
        <StatsCard label="Confirmed payment receipts" value={formatBDT(s.receipts.net)} icon={Landmark} tone="success" hint={`${formatNumber(s.receipts.count)} payments · ${formatBDT(s.receipts.gross)} incl. ${formatBDT(s.receipts.vat)} VAT`} />
        <StatsCard label="Payment refunds" value={formatBDT(s.paymentRefunds.amount)} icon={RotateCcw} tone="warning" hint={`${formatNumber(s.paymentRefunds.count)} refunds recorded`} />
        <StatsCard label="Usage revenue (gross)" value={formatBDT(s.usage.revenue)} icon={Coins} tone="primary" hint="SMS charges − failed-SMS refunds + sender-ID fees, excl. VAT" />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Usage revenue</CardTitle>
            <CardDescription>What customers consumed in the period.</CardDescription>
          </CardHeader>
          <dl className="divide-y divide-border text-sm">
            {[
              ["SMS charges", s.usage.smsCharges],
              ["Failed-SMS refunds", `−${s.usage.smsRefunds}`],
              ["Sender-ID fees", s.usage.senderIdFees],
              ["Usage revenue", s.usage.revenue],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between px-5 py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular">{v.startsWith("−") ? `−${formatBDT(v.slice(1))}` : formatBDT(v)}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Provider cost and margin</CardTitle>
            <CardDescription>{pc.basis === "estimate" ? `Estimate from configured wholesale rates (from ${pc.ratesEffectiveFrom ?? "?"}), not reconciled with provider invoices.` : "No verified provider rates configured yet."}</CardDescription>
          </CardHeader>
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-muted-foreground">Billed to customers (net of refunds)</dt>
              <dd className="tabular">{formatBDT(pc.billed)}</dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-muted-foreground">Estimated provider cost</dt>
              <dd className="tabular">{pc.estimatedCost !== null ? formatBDT(pc.estimatedCost) : <Badge tone="outline">not configured</Badge>}</dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-muted-foreground">Estimated gross margin</dt>
              <dd className="tabular">{pc.estimatedMargin !== null ? formatBDT(pc.estimatedMargin) : "—"}</dd>
            </div>
          </dl>
          <CardContent className="pt-3 text-xs text-muted-foreground">
            Payment-gateway fees are not recorded, so they are not deducted. No net profit figure is shown. <Link href={`/admin/costs?${qs}`} className="text-primary hover:underline">Margins by customer →</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Other movements</CardTitle>
          </CardHeader>
          <dl className="divide-y divide-border text-sm">
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-muted-foreground">Package bonus credit given</dt>
              <dd className="tabular">{formatBDT(s.receipts.bonusCredit)}</dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-muted-foreground">Manual credits ({formatNumber(s.adjustments.count)} adjustments)</dt>
              <dd className="tabular">{formatBDT(s.adjustments.credit)}</dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-muted-foreground">Manual debits</dt>
              <dd className="tabular">{formatBDT(s.adjustments.debit)}</dd>
            </div>
            <div className="flex justify-between px-5 py-2.5">
              <dt className="text-muted-foreground">Manual payments awaiting verification</dt>
              <dd>
                <Link href="/admin/payments?status=AWAITING_VERIFICATION" className="text-primary hover:underline">
                  {formatNumber(s.pendingManualPayments)}
                </Link>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="size-4" aria-hidden /> Platform ledger
          </CardTitle>
          <CardDescription>Every balance movement, newest first. Entries are never edited; corrections are new entries.</CardDescription>
        </CardHeader>
        <RangeFilter value={range} hidden={{ org: organizationId }}>
          <label htmlFor="lf-reason" className="sr-only">
            Reason
          </label>
          <NativeSelect id="lf-reason" name="reason" defaultValue={reason ?? ""} className="sm:w-44">
            <option value="">All reasons</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replaceAll("_", " ").toLowerCase()}
              </option>
            ))}
          </NativeSelect>
          <label htmlFor="lf-type" className="sr-only">
            Direction
          </label>
          <NativeSelect id="lf-type" name="type" defaultValue={type ?? ""} className="sm:w-36">
            <option value="">Credit & debit</option>
            <option value="CREDIT">Credits</option>
            <option value="DEBIT">Debits</option>
          </NativeSelect>
        </RangeFilter>
        <DataTable
          caption="Platform ledger"
          rows={tx.rows}
          getKey={(t) => t.id}
          empty={<EmptyState icon={ReceiptText} title="No ledger entries in this period" />}
          columns={[
            { key: "date", header: "When", cell: (t) => <span className="whitespace-nowrap text-muted-foreground">{t.createdAt ? formatDateTime(t.createdAt) : ""}</span> },
            { key: "org", header: "Customer", mobile: "title", cell: (t) => (t.organization ? <Link href={`/admin/customers/${t.organization.id}`} className="font-medium hover:text-primary">{t.organization.name}</Link> : "—") },
            { key: "reason", header: "Reason", cell: (t) => <Badge tone="outline">{t.reason.replaceAll("_", " ").toLowerCase()}</Badge> },
            { key: "desc", header: "Description", cell: (t) => <span className="line-clamp-1 max-w-72 text-muted-foreground">{t.description}</span> },
            { key: "amount", header: "Amount", align: "right", cell: (t) => <span className={t.type === "CREDIT" ? "text-success tabular" : "tabular"}>{t.type === "CREDIT" ? "+" : "−"}{formatBDT(t.amount)}</span> },
            { key: "after", header: "Balance after", align: "right", cell: (t) => <span className="tabular text-muted-foreground">{formatBDT(t.balanceAfter)}</span> },
          ]}
        />
        {tx.rows.length > 0 && <Pagination page={page} pageSize={tx.pageSize} total={tx.total} searchParams={sp} basePath="/admin/finance" />}
      </Card>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Banknote className="size-4" aria-hidden /> Wallet liability is a balance today; receipts, refunds and revenue cover the selected period (Asia/Dhaka days).
      </p>
    </>
  );
}
