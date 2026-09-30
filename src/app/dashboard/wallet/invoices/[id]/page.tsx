import { notFound } from "next/navigation";
import { Logo } from "@/components/shared/logo";
import { PrintButton } from "@/components/shared/print-button";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";
import { formatBDT, formatDate } from "@/lib/format";
import { siteConfig } from "@/config/site";
import { getSiteContent } from "@/services/settings";
import { getInvoice } from "@/features/wallet/service";

export const metadata = { title: "Invoice" };

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
}

export default async function InvoicePage({ params }: PageProps<"/dashboard/wallet/invoices/[id]">) {
  const { id } = await params;
  const { ctx, allowed } = await tenantWithPermission("billing:read");
  if (!allowed) return <PermissionDenied permission="billing:read" />;
  let inv;
  try {
    inv = await getInvoice(ctx, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const { contactResolved } = await getSiteContent();
  const items = inv.lineItems as unknown as LineItem[];

  return (
    <>
      <div className="print:hidden">
        <PageHeader back={{ href: "/dashboard/wallet", label: "Wallet" }} title={`Invoice ${inv.number}`} actions={<PrintButton />} />
      </div>
      <article className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-8 shadow-sm print:border-0 print:p-0 print:shadow-none" aria-label={`Invoice ${inv.number}`}>
        <header className="flex flex-col justify-between gap-6 sm:flex-row">
          <div>
            <Logo />
            <address className="mt-3 text-sm not-italic text-muted-foreground">
              {siteConfig.legalName}
              <br />
              {contactResolved.address}
              <br />
              {contactResolved.email}
            </address>
          </div>
          <div className="sm:text-right">
            <h1 className="text-2xl font-semibold tracking-tight">Tax invoice</h1>
            <dl className="mt-2 text-sm">
              <div>
                <dt className="inline text-muted-foreground">Invoice no. </dt>
                <dd className="inline font-mono font-medium">{inv.number}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Issued </dt>
                <dd className="inline">{formatDate(inv.issuedAt)}</dd>
              </div>
              <div>
                <dt className="inline text-muted-foreground">Status </dt>
                <dd className="inline font-medium text-success">{inv.status === "PAID" ? "Paid" : inv.status}</dd>
              </div>
            </dl>
          </div>
        </header>
        <section className="mt-8 rounded-md bg-surface p-4 text-sm print:bg-transparent print:p-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Billed to</h2>
          <p className="mt-1 font-medium">{inv.billingName}</p>
          {inv.billingAddress && <p className="text-muted-foreground">{inv.billingAddress}</p>}
          {inv.billingEmail && <p className="text-muted-foreground">{inv.billingEmail}</p>}
          {inv.taxId && <p className="text-muted-foreground">BIN: {inv.taxId}</p>}
        </section>
        <table className="mt-8 w-full text-sm">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 font-medium">Description</th>
              <th scope="col" className="py-2 text-right font-medium">Qty</th>
              <th scope="col" className="py-2 text-right font-medium">Unit price</th>
              <th scope="col" className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((li, i) => (
              <tr key={i} className="border-b border-border">
                <td className="py-3">{li.description}</td>
                <td className="py-3 text-right tabular">{li.quantity}</td>
                <td className="py-3 text-right tabular">{formatBDT(li.unitPrice)}</td>
                <td className="py-3 text-right tabular">{formatBDT(li.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Subtotal</dt>
            <dd className="tabular">{formatBDT(inv.subtotal.toString())}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">VAT ({inv.vatRate.toString()}%)</dt>
            <dd className="tabular">{formatBDT(inv.vatAmount.toString())}</dd>
          </div>
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>Total paid</dt>
            <dd className="tabular">{formatBDT(inv.total.toString())}</dd>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <dt>Credited to SMS wallet</dt>
            <dd className="tabular">{formatBDT(inv.payment.creditAmount.toString())}</dd>
          </div>
        </dl>
        <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>
            Payment method: {inv.payment.method ?? "-"}
            {inv.payment.providerRef ? ` · Reference ${inv.payment.providerRef}` : inv.payment.manualReference ? ` · Reference ${inv.payment.manualReference}` : ""}
          </p>
          <p className="mt-1">Prepaid SMS wallet credit. Unused balance is handled according to the refund policy. This is a computer-generated invoice.</p>
        </footer>
      </article>
    </>
  );
}
