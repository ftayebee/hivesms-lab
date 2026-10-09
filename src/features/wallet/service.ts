import { z } from "zod";
import { Decimal } from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, assertOrgActive, requirePermission, type TenantContext } from "@/lib/auth/context";
import { topUpBreakdown } from "@/lib/pricing";
import { toCsv } from "@/lib/csv";
import { getBillingPolicy } from "@/services/settings";
import { getPaymentProvider } from "@/services/payments";
import type { DateRange } from "@/features/reports/range";
import { getBalanceSummary } from "@/features/reports/queries";
import { getActivePackages } from "@/services/billing/pricing";
import { getPaymentSettings } from "@/services/settings";
import { listAvailablePaymentProviders } from "@/services/payments";
import { laravelEnabled } from "@/lib/laravel/flags";
import * as viaLaravel from "./laravel";

export const topUpSchema = z
  .object({
    packageId: z
      .string()
      .optional()
      .transform((v) => v || undefined)
      .pipe(z.uuid().optional()),
    amount: z.coerce.number().positive("Enter an amount.").max(10_000_000).optional().catch(undefined),
    provider: z.string().min(1, "Choose a payment method.").max(30),
  })
  .refine((v) => v.packageId || v.amount, { message: "Choose a package or enter an amount.", path: ["amount"] });

export type TopUpInput = z.infer<typeof topUpSchema>;

export async function previewTopUp(input: { packageId?: string; amount?: number }) {
  if (laravelEnabled("payments")) {
    const b = await viaLaravel.previewTopUp(input);
    return {
      subtotal: new Decimal(b.subtotal),
      vatRate: new Decimal(b.vatRate),
      vatAmount: new Decimal(b.vatAmount),
      total: new Decimal(b.total),
      bonus: new Decimal(b.bonus),
      creditAmount: new Decimal(b.creditAmount),
      packageId: b.packageId,
      label: b.label,
      bonusPercent: new Decimal(b.bonusPercent),
    };
  }
  const policy = await getBillingPolicy();
  let amount: Decimal;
  let bonus = new Decimal(0);
  let packageId: string | null = null;
  let label = "Custom amount";
  if (input.packageId) {
    const pkg = await db.creditPackage.findFirst({ where: { id: input.packageId, active: true } });
    if (!pkg) throw new AppError("VALIDATION_ERROR", "That package is no longer available.", { field: "packageId" });
    amount = new Decimal(pkg.amount.toString());
    bonus = new Decimal(pkg.bonusPercent.toString());
    packageId = pkg.id;
    label = pkg.name;
  } else {
    amount = new Decimal(input.amount ?? 0).toDecimalPlaces(2);
    if (amount.lt(policy.minimumTopUp)) throw new AppError("VALIDATION_ERROR", `The minimum top-up is BDT ${policy.minimumTopUp}.`, { field: "amount" });
    if (amount.gt(policy.maximumTopUp)) throw new AppError("VALIDATION_ERROR", `The maximum online top-up is BDT ${policy.maximumTopUp}. Contact sales for larger amounts.`, { field: "amount" });
  }
  return { ...topUpBreakdown(amount, policy.vatRatePercent, bonus), packageId, label, bonusPercent: bonus };
}

/** Creates a pending payment and starts checkout with the chosen provider. */
export async function createTopUp(ctx: TenantContext, input: TopUpInput, customer: { name: string; email: string; phone: string | null }) {
  requirePermission(ctx, "billing:manage");
  assertOrgActive(ctx);
  if (laravelEnabled("payments")) return viaLaravel.createTopUp(input, ctx);
  const provider = await getPaymentProvider(input.provider);
  if (!provider) throw new AppError("VALIDATION_ERROR", "That payment method is not available.", { field: "provider" });
  const b = await previewTopUp(input);
  const recentPending = await db.payment.count({ where: { organizationId: ctx.organizationId, status: "PENDING", createdAt: { gte: new Date(Date.now() - 3600_000) } } });
  if (recentPending >= 10) throw new AppError("RATE_LIMITED", "Too many unfinished payments. Complete or cancel an existing one first.");

  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true } });
  const payment = await db.payment.create({
    data: {
      organizationId: ctx.organizationId,
      provider: provider.key,
      packageId: b.packageId,
      amount: b.subtotal.toString(),
      vatRate: b.vatRate.toString(),
      vatAmount: b.vatAmount.toString(),
      total: b.total.toString(),
      creditAmount: b.creditAmount.toString(),
      method: provider.displayName,
      initiatedById: ctx.userId,
      metadata: { label: b.label, bonusPercent: b.bonusPercent.toString() },
    },
  });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const result = await provider.createCheckout({
    paymentId: payment.id,
    total: b.total.toFixed(2),
    currency: "BDT",
    description: `SMS wallet top-up (${b.label})`,
    customer: { name: customer.name, email: customer.email, phone: customer.phone, organization: org.name },
    successUrl: `${base}/api/v1/payments/${provider.key}/return?status=success`,
    failUrl: `${base}/api/v1/payments/${provider.key}/return?status=fail`,
    cancelUrl: `${base}/api/v1/payments/${provider.key}/return?status=cancel`,
    callbackUrl: `${base}/api/v1/webhooks/payments/${provider.key}`,
  });
  await db.payment.update({
    where: { id: payment.id },
    data: {
      providerRef: result.type === "redirect" ? (result.providerRef ?? null) : null,
      metadata: { label: b.label, bonusPercent: b.bonusPercent.toString(), checkout: result.type } as Prisma.InputJsonValue,
    },
  });
  await audit({ action: "payment.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "payment", targetId: payment.id, metadata: { provider: provider.key, total: b.total.toFixed(2) } });
  return { payment, result };
}

/** Payment page: the payment plus the manual-transfer instructions to show for manual payments. */
export async function getPaymentForPage(ctx: TenantContext, id: string) {
  requirePermission(ctx, "billing:read");
  if (laravelEnabled("wallet")) {
    const { manualInstructions, ...payment } = await viaLaravel.getPayment(id);
    return { payment, manualInstructions: manualInstructions ?? "" };
  }
  const [payment, settings] = await Promise.all([getOwnPayment(ctx, id), getPaymentSettings()]);
  return { payment, manualInstructions: settings.manualInstructions };
}

export async function getOwnPayment(ctx: TenantContext, id: string) {
  requirePermission(ctx, "billing:read");
  if (laravelEnabled("wallet")) return viaLaravel.getPayment(id);
  const p = await db.payment.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { invoice: { select: { id: true, number: true } } } });
  if (!p) throw notFound("Payment");
  return p;
}

export async function submitManualReference(ctx: TenantContext, id: string, reference: string) {
  requirePermission(ctx, "billing:manage");
  if (laravelEnabled("payments")) return viaLaravel.submitManualReference(id, reference);
  const p = await getOwnPayment(ctx, id);
  if (p.provider !== "manual") throw new AppError("VALIDATION_ERROR", "This payment does not use manual verification.");
  const r = await db.payment.updateMany({ where: { id, status: { in: ["PENDING", "AWAITING_VERIFICATION"] } }, data: { status: "AWAITING_VERIFICATION", manualReference: reference } });
  if (!r.count) throw new AppError("CONFLICT", "This payment can no longer be updated.");
  await audit({ action: "payment.reference_submitted", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "payment", targetId: id });
}

export async function cancelPendingPayment(ctx: TenantContext, id: string) {
  requirePermission(ctx, "billing:manage");
  if (laravelEnabled("payments")) return viaLaravel.cancelPendingPayment(id);
  await getOwnPayment(ctx, id);
  const r = await db.payment.updateMany({ where: { id, status: "PENDING" }, data: { status: "CANCELLED", failureReason: "Cancelled by customer" } });
  if (!r.count) throw new AppError("CONFLICT", "Only unpaid payments can be cancelled.");
  await audit({ action: "payment.cancelled", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "payment", targetId: id });
}

/** Wallet page: balance summary, top-up rules, packages, providers, recent payments and invoices. */
export async function loadWalletPage(ctx: TenantContext, canManage: boolean) {
  requirePermission(ctx, "billing:read");
  if (laravelEnabled("wallet")) {
    const w = await viaLaravel.loadWalletPage();
    return { ...w, providers: canManage ? w.providers : [] };
  }
  const [summary, policy, packages, providers, payments, invoices] = await Promise.all([
    getBalanceSummary(ctx),
    getBillingPolicy(),
    getActivePackages(),
    canManage ? listAvailablePaymentProviders() : Promise.resolve([]),
    listPayments(ctx, 10),
    listInvoices(ctx, 20),
  ]);
  return { summary, policy, packages, providers, payments, invoices };
}

export async function listPayments(ctx: TenantContext, take = 20) {
  requirePermission(ctx, "billing:read");
  return db.payment.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take, include: { invoice: { select: { id: true, number: true } } } });
}

export async function listInvoices(ctx: TenantContext, take = 50) {
  requirePermission(ctx, "billing:read");
  return db.invoice.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { issuedAt: "desc" }, take });
}

export async function getInvoice(ctx: TenantContext, id: string) {
  requirePermission(ctx, "billing:read");
  if (laravelEnabled("wallet")) return viaLaravel.getInvoice(id);
  const inv = await db.invoice.findFirst({ where: { id, organizationId: ctx.organizationId }, include: { payment: { select: { method: true, providerRef: true, manualReference: true, completedAt: true, creditAmount: true } } } });
  if (!inv) throw notFound("Invoice");
  return inv;
}

export const TX_PAGE_SIZE = 30;

export const txFilterSchema = z.object({
  type: z.enum(["CREDIT", "DEBIT"]).optional().catch(undefined),
  reason: z.enum(["TOPUP", "BONUS", "SMS_CHARGE", "REFUND", "ADJUSTMENT", "SENDER_ID_FEE"]).optional().catch(undefined),
});

function txWhere(ctx: TenantContext, range: DateRange, f: z.infer<typeof txFilterSchema>): Prisma.WalletTransactionWhereInput {
  return { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.to }, ...(f.type ? { type: f.type } : {}), ...(f.reason ? { reason: f.reason } : {}) };
}

export async function listTransactions(ctx: TenantContext, range: DateRange, f: z.infer<typeof txFilterSchema>, page: number) {
  requirePermission(ctx, "billing:read");
  if (laravelEnabled("wallet")) return viaLaravel.listTransactions(range, f, page);
  const where = txWhere(ctx, range, f);
  const [rows, total, sums] = await Promise.all([
    db.walletTransaction.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * TX_PAGE_SIZE, take: TX_PAGE_SIZE }),
    db.walletTransaction.count({ where }),
    db.walletTransaction.groupBy({ by: ["type"], where, _sum: { amount: true } }),
  ]);
  const credit = new Decimal(sums.find((s) => s.type === "CREDIT")?._sum.amount?.toString() ?? "0");
  const debit = new Decimal(sums.find((s) => s.type === "DEBIT")?._sum.amount?.toString() ?? "0");
  return { rows, total, credit, debit };
}

export async function exportTransactionsCsv(ctx: TenantContext, range: DateRange, f: z.infer<typeof txFilterSchema>) {
  requirePermission(ctx, "billing:read");
  const rows = await db.walletTransaction.findMany({ where: txWhere(ctx, range, f), orderBy: { createdAt: "desc" }, take: 100_000 });
  return toCsv(
    ["date", "type", "reason", "description", "amount_bdt", "balance_after_bdt", "reference_type", "reference_id", "transaction_id"],
    rows.map((r) => [r.createdAt, r.type, r.reason, r.description, (r.type === "DEBIT" ? "-" : "") + r.amount.toFixed(2), r.balanceAfter.toFixed(2), r.referenceType, r.referenceId, r.id]),
  );
}

export async function updateLowBalanceThreshold(ctx: TenantContext, threshold: number) {
  requirePermission(ctx, "billing:manage");
  if (laravelEnabled("wallet")) return viaLaravel.updateLowBalanceThreshold(threshold);
  await db.wallet.update({ where: { organizationId: ctx.organizationId }, data: { lowBalanceThreshold: threshold.toFixed(2), lowBalanceNotifiedAt: null } });
  await audit({ action: "wallet.threshold_update", actor: actorOf(ctx), organizationId: ctx.organizationId, metadata: { threshold } });
}
