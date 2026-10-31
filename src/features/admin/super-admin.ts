import "server-only";
import { z } from "zod";
import type { PlatformRole, WalletTxReason, WalletTxType } from "@/generated/prisma/enums";
import { laravel, laravelData } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { AppError } from "@/lib/errors";
import { date, pageMeta } from "@/lib/laravel/convert";

/**
 * Super Admin panel features that exist only in the Laravel API (docs/18): platform dashboard,
 * finance (liability, receipts, refunds, usage revenue, ledger), provider costs and margin
 * estimates, payment refunds, staff invitations, account recovery and system health. Laravel is
 * authoritative for every rule and permission; there is deliberately no Prisma copy of these.
 * Without LARAVEL_FEATURES `admin` the pages explain that instead of computing anything.
 */

const enc = encodeURIComponent;

export function superAdminAvailable() {
  return laravelEnabled("admin");
}

function requireLaravel() {
  if (!laravelEnabled("admin")) throw new AppError("FEATURE_DISABLED", "This needs the Laravel admin API (LARAVEL_FEATURES `admin`).");
}

export type RangeQuery = { range?: string; from?: string; to?: string };

export function parseRange(sp: Record<string, string | string[] | undefined>): RangeQuery {
  const one = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const range = ["today", "7d", "30d", "90d", "custom"].find((r) => r === sp.range) ?? "30d";
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  return range === "custom" ? { range, from: day(one(sp.from)), to: day(one(sp.to)) } : { range };
}

// ─── Dashboard & finance ───

interface Sms {
  total: number;
  segments: number;
  delivered: number;
  failed: number;
  pending: number;
}

export interface FinanceSummary {
  range: { key: string; from: string; to: string; days: number; label: string };
  liability: { balance: string; wallets: number; funded: number };
  receipts: { count: number; net: string; vat: string; gross: string; bonusCredit: string };
  paymentRefunds: { count: number; amount: string };
  usage: { smsCharges: string; smsRefunds: string; senderIdFees: string; revenue: string };
  adjustments: { credit: string; debit: string; count: number };
  pendingManualPayments: number;
  providerCost: MarginTotals;
}

export interface MarginTotals {
  messages: number;
  billed: string;
  refunded: string;
  providerSegments: number;
  estimatedCost: string | null;
  estimatedMargin: string | null;
  basis: "estimate" | "not_configured";
  ratesEffectiveFrom?: string | null;
}

export interface PlatformDashboard {
  range: FinanceSummary["range"];
  customers: { total: number; active: number; suspended: number; underReview: number; pending: number; newInRange: number; users: number; customerUsers: number; activeStaff: number };
  plans: Array<{ id: string | null; name: string; active: boolean; organizations: number }>;
  subscriptions: { supported: boolean; note: string };
  sms: { today: Sms; month: Sms; range: Sms };
  queues: { manualPayments: number; senderIds: number; campaignReviews: number; openTickets: number; urgentTickets: number; newAbuseReports: number };
  finance: FinanceSummary | null;
  recentPrivilegedActions: Array<{ id: string; action: string; actorType: string; createdAt: Date | null; actor: { name: string } | null; organization: { id: string; name: string } | null; metadata: Record<string, unknown> | null }> | null;
}

type RawAudit = { id: string; action: string; actorType: string; createdAt: string; actor?: { name: string } | null; organization?: { id: string; name: string } | null; metadata?: Record<string, unknown> | null };
const toAudit = (a: RawAudit) => ({ id: a.id, action: a.action, actorType: a.actorType, createdAt: date(a.createdAt), actor: a.actor ?? null, organization: a.organization ?? null, metadata: a.metadata ?? null });

export async function platformDashboard(q: RangeQuery): Promise<PlatformDashboard> {
  requireLaravel();
  const d = await laravelData<Omit<PlatformDashboard, "recentPrivilegedActions"> & { recentPrivilegedActions: RawAudit[] | null }>("admin/dashboard", q);
  return { ...d, recentPrivilegedActions: d.recentPrivilegedActions?.map(toAudit) ?? null };
}

export async function financeSummary(q: RangeQuery) {
  requireLaravel();
  return laravelData<FinanceSummary>("admin/finance/summary", q);
}

export async function ledger(q: RangeQuery & { organizationId?: string; reason?: string; type?: string; page: number }) {
  requireLaravel();
  const res = await laravel.get<
    Array<{ id: string; type: WalletTxType; reason: WalletTxReason; amount: string; balanceAfter: string; description: string; referenceType: string | null; referenceId: string | null; createdAt: string; createdById?: string | null; organization?: { id: string; name: string } | null }>
  >("admin/finance/transactions", q);
  const meta = pageMeta(res.meta, 50);
  return { rows: res.data.map((t) => ({ ...t, createdAt: date(t.createdAt) })), total: meta.total, pageSize: meta.pageSize };
}

export async function margins(q: RangeQuery & { groupBy: string; page: number }) {
  requireLaravel();
  const res = await laravel.get<Array<{ key: string | null; label: string | null; messages: number; billed: string; refunded: string; providerSegments: number; estimatedCost: string | null; estimatedMargin: string | null }>>(
    "admin/finance/margins",
    q,
  );
  const meta = pageMeta(res.meta, 50);
  return { rows: res.data, total: meta.total, pageSize: meta.pageSize, basis: res.meta.basis as MarginTotals["basis"], totals: res.meta.totals as MarginTotals };
}

export interface ProviderCosts {
  provider: string;
  currency: string;
  rates: Record<"transactionalMasking" | "transactionalNonMasking" | "promotionalMasking" | "promotionalNonMasking", string>;
  effectiveFrom: string;
  source: string;
  updatedAt: string | null;
}

export async function providerCosts() {
  requireLaravel();
  const d = await laravelData<{ current: ProviderCosts | null; history: RawAudit[] }>("admin/finance/provider-costs");
  return { current: d.current, history: d.history.map(toAudit) };
}

const rate = z.string().trim().regex(/^\d{1,3}(\.\d{1,4})?$/, "Enter BDT per segment (up to 4 decimals).");
export const providerCostSchema = z.object({
  provider: z.string().trim().regex(/^[a-z0-9_-]{2,30}$/, "Provider key: lower-case letters, digits, - or _."),
  transactionalMasking: rate,
  transactionalNonMasking: rate,
  promotionalMasking: rate,
  promotionalNonMasking: rate,
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the rates apply from."),
  source: z.string().trim().min(5, "Say where the rates come from (contract, invoice…).").max(300),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500),
  currentPassword: z.string().min(1, "Confirm with your current password.").max(200),
});

export async function saveProviderCosts(input: z.infer<typeof providerCostSchema>) {
  requireLaravel();
  const { transactionalMasking, transactionalNonMasking, promotionalMasking, promotionalNonMasking, ...rest } = input;
  await laravel.put("admin/finance/provider-costs", { ...rest, rates: { transactionalMasking, transactionalNonMasking, promotionalMasking, promotionalNonMasking } });
}

export async function refundPayment(id: string, reason: string, currentPassword: string) {
  requireLaravel();
  await laravel.post(`admin/payments/${enc(id)}/refund`, { reason, currentPassword });
}

export async function systemHealth() {
  requireLaravel();
  return laravelData<{ ok: boolean; checks: Record<string, string>; environment: string }>("admin/system/health");
}

// ─── Staff & accounts ───

export const staffInviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  name: z.string().trim().min(2, "Enter a name.").max(100),
  role: z.enum(["SUPPORT", "ADMIN", "SUPER_ADMIN"]),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500),
  currentPassword: z.string().min(1, "Confirm with your current password.").max(200),
});

export async function inviteStaff(input: z.infer<typeof staffInviteSchema>) {
  requireLaravel();
  const res = await laravel.post<{ id: string; email: string; platformRole: PlatformRole }>("admin/staff", input);
  return { created: Boolean(res.meta.created), message: String(res.meta.message ?? "Done.") };
}

export async function staffHistory(page: number) {
  requireLaravel();
  const res = await laravel.get<RawAudit[]>("admin/staff/history", { page });
  const meta = pageMeta(res.meta, 50);
  return { rows: res.data.map(toAudit), total: meta.total, pageSize: meta.pageSize };
}

export async function sendPasswordReset(userId: string, reason: string | null) {
  requireLaravel();
  await laravel.post(`admin/users/${enc(userId)}/password-reset`, { reason });
}

/** Customer detail extras (API-key status, support history, verification, plan history, 30-day totals). */
export async function customerExtras(id: string) {
  requireLaravel();
  const d = await laravelData<{
    apiKeys: Array<{ id: string; name: string; prefix: string; status: string; scopes: string[]; lastUsedAt: string | null; expiresAt: string | null; createdAt: string }>;
    tickets: Array<{ id: string; number: number; subject: string; status: string; priority: string; createdAt: string; lastReplyAt: string | null }>;
    statusTotals30: Record<string, { count: number; cost: string }> | [];
    verification: Array<{ userId: string; emailVerified: boolean; phoneVerified: boolean }>;
    planHistory: RawAudit[];
  }>(`admin/customers/${enc(id)}`);
  return {
    apiKeys: d.apiKeys.map((k) => ({ ...k, lastUsedAt: date(k.lastUsedAt), expiresAt: date(k.expiresAt), createdAt: date(k.createdAt) })),
    tickets: d.tickets.map((t) => ({ ...t, createdAt: date(t.createdAt), lastReplyAt: date(t.lastReplyAt) })),
    statusTotals30: Array.isArray(d.statusTotals30) ? {} : d.statusTotals30,
    verification: new Map(d.verification.map((v) => [v.userId, v])),
    planHistory: d.planHistory.map(toAudit),
  };
}

// ─── Customer usage ───

export interface UsageCounts {
  messages: number;
  segments: number;
  delivered: number;
  pending: number;
  failed: number;
  charged: string;
}
type UsageDay = { day: string; delivered: number; pending: number; failed: number; spend: number };

export async function usageOverview(q: RangeQuery & { q?: string; page: number }) {
  requireLaravel();
  const res = await laravel.get<Array<UsageCounts & { id: string; name: string; status: string; plan: string | null; lastSentAt: string | null }>>("admin/usage", q);
  const meta = pageMeta(res.meta, 50);
  return {
    rows: res.data.map((r) => ({ ...r, lastSentAt: date(r.lastSentAt) })),
    total: meta.total,
    pageSize: meta.pageSize,
    totals: res.meta.totals as UsageCounts,
    activeCustomers: res.meta.activeCustomers as number,
    series: res.meta.series as UsageDay[],
  };
}

export async function customerUsage(id: string, q: RangeQuery) {
  requireLaravel();
  return laravelData<{ totals: UsageCounts; series: UsageDay[]; bySource: Record<string, number> | []; byType: Record<string, number> | [] }>(`admin/customers/${enc(id)}/usage`, q);
}

export const EXPORT_KINDS =["customers", "payments", "transactions", "margins", "audit-logs"] as const;
