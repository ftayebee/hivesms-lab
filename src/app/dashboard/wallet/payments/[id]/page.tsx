import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/shared/auto-refresh";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { isAppError } from "@/lib/errors";
import { formatBDT, formatDateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { getPaymentSettings } from "@/services/settings";
import { getOwnPayment } from "@/features/wallet/service";
import { CancelPaymentButton, ReferenceForm } from "@/features/wallet/components/wallet-controls";

export const metadata = { title: "Payment" };

export default async function PaymentPage({ params, searchParams }: PageProps<"/dashboard/wallet/payments/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ctx, allowed } = await tenantWithPermission("billing:read");
  if (!allowed) return <PermissionDenied permission="billing:read" />;
  const { t } = await getT();
  let p;
  try {
    p = await getOwnPayment(ctx, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const settings = await getPaymentSettings();
  const canManage = can(ctx, "billing:manage");
  const Icon = p.status === "SUCCEEDED" ? CheckCircle2 : p.status === "FAILED" || p.status === "CANCELLED" ? XCircle : Clock;

  return (
    <>
      {p.status === "PENDING" && p.provider !== "manual" && <AutoRefresh intervalMs={5000} />}
      <PageHeader back={{ href: "/dashboard/wallet", label: "Wallet" }} title={`Payment of ${formatBDT(p.total.toString())}`} description={<StatusBadge status={p.status} label={t.status[p.status as keyof typeof t.status]} />} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] [&>*]:min-w-0">
        <div className="space-y-6">
          {sp.result === "not_completed" && p.status === "PENDING" && (
            <Alert tone="warning" title="The payment was not completed">
              The payment page reported that the payment did not go through. You can try again or cancel this payment. If money was deducted from your account, contact support with the payment details shown here.
            </Alert>
          )}
          {p.status === "SUCCEEDED" && (
            <Alert tone="success" title="Payment successful">
              {formatBDT(p.creditAmount.toString())} was added to your wallet{p.completedAt ? ` on ${formatDateTime(p.completedAt)}` : ""}.{" "}
              {p.invoice && (
                <Link href={`/dashboard/wallet/invoices/${p.invoice.id}`} className="font-medium text-primary hover:underline">
                  View invoice {p.invoice.number}
                </Link>
              )}
            </Alert>
          )}
          {(p.status === "FAILED" || p.status === "CANCELLED") && (
            <Alert tone="danger" title={p.status === "FAILED" ? "Payment failed" : "Payment cancelled"}>
              {p.failureReason ?? "No money was taken for this payment."}{" "}
              <Link href="/dashboard/wallet" className="font-medium text-primary hover:underline">
                Try again
              </Link>
            </Alert>
          )}
          {p.provider === "manual" && (p.status === "PENDING" || p.status === "AWAITING_VERIFICATION") && (
            <Card>
              <CardHeader>
                <CardTitle>Pay by bank transfer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="whitespace-pre-wrap text-sm">{settings.manualInstructions}</p>
                <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface p-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Amount to pay</dt>
                    <dd className="text-lg font-semibold tabular">{formatBDT(p.total.toString())}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Payment reference (include it in your transfer note)</dt>
                    <dd className="font-mono text-sm font-semibold">{p.id.slice(0, 8).toUpperCase()}</dd>
                  </div>
                </dl>
                {p.status === "AWAITING_VERIFICATION" && (
                  <Alert tone="info" title="Waiting for verification">
                    We received your reference <span className="font-mono">{p.manualReference}</span>. Balance is added once our team confirms the transfer, usually within one working day.
                  </Alert>
                )}
                {canManage && <ReferenceForm paymentId={p.id} current={p.manualReference} />}
              </CardContent>
            </Card>
          )}
          {p.provider !== "manual" && p.status === "PENDING" && (
            <Alert tone="info" title="Waiting for the payment provider">
              If you completed the payment, this page updates automatically when the provider confirms it.
            </Alert>
          )}
        </div>
        <Card className="h-fit">
          <CardContent className="space-y-3 pt-5 text-sm">
            <Icon className="size-6 text-muted-foreground" aria-hidden />
            {[
              ["Top-up", formatBDT(p.amount.toString())],
              [`VAT (${p.vatRate.toString()}%)`, formatBDT(p.vatAmount.toString())],
              ["Total", formatBDT(p.total.toString())],
              ["Wallet credit", formatBDT(p.creditAmount.toString())],
              ["Method", p.method ?? p.provider],
              ["Created", formatDateTime(p.createdAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-right font-medium tabular">{v}</span>
              </div>
            ))}
            {canManage && p.status === "PENDING" && (
              <div className="flex justify-end">
                <CancelPaymentButton id={p.id} />
              </div>
            )}
            <Button asChild variant="secondary" className="w-full">
              <Link href="/dashboard/wallet">Back to wallet</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
