import Link from "next/link";
import { FileText, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatBDT, formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { getT } from "@/i18n/server";
import { loadWalletPage } from "@/features/wallet/service";
import { laravelPage } from "@/lib/laravel-api";
import { TopUpForm } from "@/features/wallet/components/top-up-form";
import { CancelPaymentButton, ThresholdForm } from "@/features/wallet/components/wallet-controls";

export const metadata = { title: "Wallet" };

export default async function WalletPage() {
  const { ctx, allowed } = await tenantWithPermission("billing:read");
  if (!allowed) return <PermissionDenied permission="billing:read" />;
  const { t } = await getT();
  const canManage = can(ctx, "billing:manage");
  const { summary, policy, packages, providers, payments, invoices } = await laravelPage(() => loadWalletPage(ctx, canManage));

  return (
    <>
      <PageHeader title="Wallet" description="Prepaid BDT balance used for every message you send." />
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <div className="bg-primary p-5 text-primary-foreground">
              <p className="flex items-center gap-2 text-sm opacity-85">
                <Wallet className="size-4" aria-hidden /> Available balance
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight tabular">{formatBDT(summary.balance.toString())}</p>
              <p className="mt-1 text-sm opacity-85">
                ≈ {formatNumber(summary.credits)} SMS credits (non-masking) · {formatNumber(summary.maskingCredits)} masking
              </p>
            </div>
            <CardContent className="space-y-4 pt-5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan</span>
                <span className="font-medium">{summary.planName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Transactional rate</span>
                <span className="font-medium tabular">{formatBDT(summary.rate.toString())} / segment</span>
              </div>
              {policy.balanceValidityMonths && (
                <p className="text-xs text-muted-foreground">Balance is valid for {policy.balanceValidityMonths} months from the last top-up.</p>
              )}
              <ThresholdForm value={summary.lowBalanceThreshold.toNumber()} disabled={!canManage} />
              <Button asChild variant="link" className="px-0">
                <Link href="/dashboard/transactions">View all transactions</Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Add balance</CardTitle>
              <CardDescription>Credits are added as soon as the payment is confirmed. Rates exclude VAT; VAT is charged on the top-up.</CardDescription>
            </CardHeader>
            <CardContent>
              <TopUpForm
                packages={packages.filter((p) => p.id).map((p) => ({ id: p.id!, name: p.name, amount: p.amount, bonusPercent: p.bonusPercent }))}
                providers={providers}
                vatRatePercent={policy.vatRatePercent}
                minimum={policy.minimumTopUp}
                maximum={policy.maximumTopUp}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">Ask an owner or admin to add balance.</CardContent>
          </Card>
        )}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Recent payments</CardTitle>
          </CardHeader>
          {payments.length ? (
            <ul className="divide-y divide-border">
              {payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/wallet/payments/${p.id}`} className="font-medium tabular hover:text-primary">
                      {formatBDT(p.total.toString())}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {p.method} · {formatDateTime(p.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} label={t.status[p.status as keyof typeof t.status]} />
                  {p.invoice && (
                    <Link href={`/dashboard/wallet/invoices/${p.invoice.id}`} className="text-xs font-medium text-primary hover:underline">
                      {p.invoice.number}
                    </Link>
                  )}
                  {canManage && p.status === "PENDING" && <CancelPaymentButton id={p.id} />}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Wallet} title="No payments yet" className="py-8" />
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>VAT invoices for completed top-ups</CardDescription>
          </CardHeader>
          {invoices.length ? (
            <ul className="divide-y divide-border">
              {invoices.map((inv) => (
                <li key={inv.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  <Link href={`/dashboard/wallet/invoices/${inv.id}`} className="flex-1 font-medium hover:text-primary">
                    {inv.number}
                  </Link>
                  <span className="text-muted-foreground">{formatDate(inv.issuedAt)}</span>
                  <span className="w-28 text-right font-medium tabular">{formatBDT(inv.total.toString())}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={FileText} title="No invoices yet" description="An invoice is issued for every completed top-up." className="py-8" />
          )}
        </Card>
      </div>
    </>
  );
}
