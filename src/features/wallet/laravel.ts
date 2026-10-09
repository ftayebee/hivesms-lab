import "server-only";
import type { z } from "zod";
import type { InvoiceStatus, PaymentStatus, WalletTxReason, WalletTxType } from "@/generated/prisma/enums";
import { sha256 } from "@/lib/crypto";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date, dec, pageMeta } from "@/lib/laravel/convert";
import { rangeToQuery, type DateRange } from "@/features/reports/range";
import type { TopUpInput, txFilterSchema } from "./service";

/**
 * Wallet (LARAVEL_FEATURES `wallet`) and payments (`payments`) through the Laravel API. Balances only
 * ever change inside Laravel (WalletService / PaymentService); nothing here can credit or debit.
 * Online gateways stay as configured in Laravel (PAYMENT_PROVIDERS=manual in production until
 * SSLCommerz is verified); mock completion only works where Laravel allows mock payments.
 */

interface LaravelSummary {
  balance: string;
  currency: string;
  lowBalanceThreshold: string;
  credits: number;
  maskingCredits: number;
  rate: string;
  planName: string;
}

interface LaravelPackage {
  id: string | null;
  name: string;
  amount: string;
  bonusPercent: string;
  description: string | null;
}

interface LaravelMethods {
  providers: Array<{ key: string; name: string; description: string; verified: boolean }>;
  packages: LaravelPackage[];
  policy: { vatRatePercent: number; minimumTopUp: number; maximumTopUp: number; balanceValidityMonths: number | null };
}

interface LaravelPayment {
  id: string;
  provider: string;
  providerRef: string | null;
  packageId: string | null;
  amount: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  creditAmount: string;
  currency: string;
  status: PaymentStatus;
  method: string | null;
  manualReference: string | null;
  label: string | null;
  failureReason: string | null;
  completedAt: string | null;
  createdAt: string;
  invoice: { id: string; number: string } | null;
}

function toPayment(p: LaravelPayment) {
  return {
    ...p,
    amount: dec(p.amount),
    vatRate: dec(p.vatRate),
    vatAmount: dec(p.vatAmount),
    total: dec(p.total),
    creditAmount: dec(p.creditAmount),
    completedAt: date(p.completedAt),
    createdAt: date(p.createdAt),
    invoice: p.invoice ?? null,
  };
}

interface LaravelInvoice {
  id: string;
  paymentId: string;
  number: string;
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  billingName: string;
  billingEmail: string | null;
  billingAddress: string | null;
  taxId: string | null;
  lineItems: unknown;
  issuedAt: string;
  payment?: { method: string | null; providerRef: string | null; manualReference: string | null; completedAt: string | null; creditAmount: string } | null;
}

function toInvoice(i: LaravelInvoice) {
  return {
    ...i,
    subtotal: dec(i.subtotal),
    vatRate: dec(i.vatRate),
    vatAmount: dec(i.vatAmount),
    total: dec(i.total),
    issuedAt: date(i.issuedAt),
    // Every invoice belongs to a payment; the list endpoint does not load it (the page does not need it there).
    payment: {
      method: i.payment?.method ?? null,
      providerRef: i.payment?.providerRef ?? null,
      manualReference: i.payment?.manualReference ?? null,
      completedAt: date(i.payment?.completedAt),
      creditAmount: dec(i.payment?.creditAmount),
    },
  };
}

/** Everything the wallet page renders (four cheap Laravel reads in parallel). */
export async function loadWalletPage() {
  const [summary, methods, payments, invoices] = await Promise.all([
    laravelData<LaravelSummary & { packages: LaravelPackage[] }>("app/wallet"),
    laravelData<LaravelMethods>("app/payments/methods"),
    laravel.get<LaravelPayment[]>("app/payments", { page: 1 }),
    laravelData<LaravelInvoice[]>("app/wallet/invoices"),
  ]);
  return {
    summary: {
      balance: dec(summary.balance),
      lowBalanceThreshold: dec(summary.lowBalanceThreshold),
      credits: summary.credits,
      maskingCredits: summary.maskingCredits,
      rate: dec(summary.rate),
      planName: summary.planName,
    },
    policy: methods.policy,
    packages: methods.packages.map((p) => ({ id: p.id, name: p.name, amount: Number(p.amount), bonusPercent: Number(p.bonusPercent), description: p.description })),
    providers: methods.providers,
    payments: payments.data.slice(0, 10).map(toPayment),
    invoices: invoices.slice(0, 20).map(toInvoice),
  };
}

interface LaravelTransaction {
  id: string;
  type: WalletTxType;
  reason: WalletTxReason;
  amount: string;
  balanceAfter: string;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export async function listTransactions(range: DateRange, f: z.infer<typeof txFilterSchema>, page: number) {
  const res = await laravel.get<LaravelTransaction[]>("app/wallet/transactions", { ...rangeToQuery(range), type: f.type, reason: f.reason, page });
  return {
    rows: res.data.map((t) => ({ ...t, amount: dec(t.amount), balanceAfter: dec(t.balanceAfter), createdAt: date(t.createdAt) })),
    total: pageMeta(res.meta, 30).total,
    credit: dec(res.meta.credit as string | undefined),
    debit: dec(res.meta.debit as string | undefined),
  };
}

export async function getPayment(id: string) {
  const res = await laravel.get<LaravelPayment>(`app/payments/${encodeURIComponent(id)}`);
  return { ...toPayment(res.data), manualInstructions: (res.meta.manualInstructions as string | undefined) ?? null };
}

export async function getInvoice(id: string) {
  return toInvoice(await laravelData<LaravelInvoice>(`app/wallet/invoices/${encodeURIComponent(id)}`));
}

export async function previewTopUp(input: { packageId?: string; amount?: number }) {
  const { data } = await laravel.post<{ subtotal: string; vatRate: string; vatAmount: string; total: string; bonus: string; creditAmount: string; label: string; packageId: string | null; bonusPercent: string }>(
    "app/payments/preview",
    { packageId: input.packageId ?? null, amount: input.amount ?? null },
  );
  return data;
}

/**
 * Creates the pending payment and starts checkout in Laravel. A double click within the same
 * minute reuses the first answer (Idempotency-Key from the member, organization and form).
 */
export async function createTopUp(input: TopUpInput, actor: { userId: string | null; organizationId: string }) {
  const body = { packageId: input.packageId ?? null, amount: input.amount ?? null, provider: input.provider };
  const key = `topup-${sha256(`${actor.organizationId}:${actor.userId}:${Math.floor(Date.now() / 60_000)}:${JSON.stringify(body)}`)}`;
  const { data } = await laravel.post<{ payment: LaravelPayment; checkout: { type: "redirect"; url: string; providerRef?: string } | { type: "manual"; instructions?: string } }>(
    "app/payments",
    body,
    { idempotencyKey: key },
  );
  return { payment: toPayment(data.payment), result: data.checkout };
}

export async function submitManualReference(id: string, reference: string) {
  await laravel.post(`app/payments/${encodeURIComponent(id)}/reference`, { reference });
}

export async function cancelPendingPayment(id: string) {
  await laravel.post(`app/payments/${encodeURIComponent(id)}/cancel`);
}

export async function mockComplete(id: string, outcome: "success" | "fail" | "cancel") {
  await laravel.post(`app/payments/${encodeURIComponent(id)}/mock-complete`, { outcome });
}

export async function updateLowBalanceThreshold(threshold: number) {
  await laravel.put("app/wallet/threshold", { threshold });
}
