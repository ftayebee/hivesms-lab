import { Decimal } from "decimal.js";
import type { Payment } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit, type AuditActor } from "@/lib/audit";
import { formatBDT } from "@/lib/format";
import { logger } from "@/lib/logger";
import { getBillingPolicy } from "@/services/settings";
import { creditWallet } from "@/services/billing/wallet";
import { notify } from "@/services/notify";
import { emailTemplates } from "@/services/email/templates";

/**
 * Payment completion is the only place that adds purchased credit to a wallet. It is idempotent:
 * the status transition is a conditional update, and the ledger's unique (reason, reference)
 * constraint would reject a second top-up for the same payment anyway.
 */
async function nextInvoiceNumber(tx: Tx, prefix: string) {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
  return `${prefix}-${new Date().getUTCFullYear()}-${String(rows[0].n).padStart(6, "0")}`;
}

export async function completePayment(
  paymentId: string,
  opts: { providerRef?: string | null; confirmedAmount?: string | null; actor: AuditActor; note?: string },
): Promise<{ status: "completed" | "already_completed"; payment: Payment }> {
  const policy = await getBillingPolicy();
  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { organization: true } });
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found.");
    if (payment.status === "SUCCEEDED") return { status: "already_completed" as const, payment };
    if (!["PENDING", "AWAITING_VERIFICATION"].includes(payment.status)) {
      throw new AppError("CONFLICT", `Payment is ${payment.status.toLowerCase()} and cannot be completed.`);
    }
    if (opts.confirmedAmount && !new Decimal(opts.confirmedAmount).eq(new Decimal(payment.total.toString()))) {
      throw new AppError("PAYMENT_FAILED", "Confirmed amount does not match the expected total.", {
        expected: payment.total.toString(),
        confirmed: opts.confirmedAmount,
      });
    }

    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: ["PENDING", "AWAITING_VERIFICATION"] } },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        ...(opts.providerRef ? { providerRef: opts.providerRef } : {}),
        reviewedById: opts.actor.type === "ADMIN" ? opts.actor.userId : undefined,
      },
    });
    if (!claimed.count) return { status: "already_completed" as const, payment };

    await creditWallet(tx, {
      organizationId: payment.organizationId,
      amount: payment.creditAmount.toString(),
      reason: "TOPUP",
      description: `Top-up (${payment.method ?? payment.provider})`,
      referenceType: "payment",
      referenceId: payment.id,
      createdById: payment.initiatedById,
    });

    const org = payment.organization;
    const number = await nextInvoiceNumber(tx, policy.invoicePrefix);
    await tx.invoice.create({
      data: {
        organizationId: org.id,
        paymentId: payment.id,
        number,
        subtotal: payment.amount,
        vatRate: payment.vatRate,
        vatAmount: payment.vatAmount,
        total: payment.total,
        status: "PAID",
        billingName: org.name,
        billingEmail: org.billingEmail,
        billingAddress: org.address,
        taxId: org.taxId,
        lineItems: [
          { description: "SMS wallet top-up", quantity: 1, unitPrice: payment.amount.toString(), amount: payment.amount.toString() },
          ...(new Decimal(payment.creditAmount.toString()).gt(new Decimal(payment.amount.toString()))
            ? [{ description: "Package bonus credit (no charge)", quantity: 1, unitPrice: "0", amount: "0" }]
            : []),
        ],
      },
    });
    await audit(
      {
        action: "payment.completed",
        actor: opts.actor,
        organizationId: org.id,
        targetType: "payment",
        targetId: payment.id,
        metadata: { total: payment.total.toString(), provider: payment.provider, note: opts.note },
      },
      tx,
    );
    const updated = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { status: "completed" as const, payment: updated, invoiceNumber: number };
  });

  if (result.status === "completed") {
    const p = result.payment;
    const invoiceNumber = "invoiceNumber" in result ? result.invoiceNumber : "";
    await notify({
      organizationId: p.organizationId,
      type: "payment.succeeded",
      title: "Payment successful",
      body: `${formatBDT(p.creditAmount.toString())} was added to your wallet.`,
      link: "/dashboard/wallet",
      email: (to) =>
        emailTemplates.paymentReceipt(to, {
          invoiceNumber,
          subtotal: formatBDT(p.amount.toString()),
          vat: formatBDT(p.vatAmount.toString()),
          total: formatBDT(p.total.toString()),
          credit: formatBDT(p.creditAmount.toString()),
          method: p.method ?? p.provider,
        }),
    });
    logger.info({ paymentId: p.id, org: p.organizationId }, "payment completed");
  }
  return { status: result.status, payment: result.payment };
}

export async function failPayment(paymentId: string, reason: string, actor: AuditActor, status: "FAILED" | "CANCELLED" = "FAILED") {
  const updated = await db.payment.updateMany({
    where: { id: paymentId, status: { in: ["PENDING", "AWAITING_VERIFICATION"] } },
    data: { status, failureReason: reason.slice(0, 500) },
  });
  if (!updated.count) return false;
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
  await audit({ action: `payment.${status.toLowerCase()}`, actor, organizationId: p.organizationId, targetType: "payment", targetId: p.id, metadata: { reason } });
  if (status === "FAILED") {
    await notify({
      organizationId: p.organizationId,
      type: "payment.failed",
      title: "Payment not completed",
      body: `Your payment of ${formatBDT(p.total.toString())} was not completed: ${reason}`,
      link: "/dashboard/wallet",
    });
  }
  return true;
}
