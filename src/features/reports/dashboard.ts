import "server-only";
import type { Decimal } from "decimal.js";
import type { CampaignStatus, SmsType, WalletTxType } from "@/generated/prisma/enums";
import type { TenantContext } from "@/lib/auth/context";
import { laravelData } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { date, dec } from "@/lib/laravel/convert";
import { rangeToQuery, type DateRange } from "./range";
import {
  getBalanceSummary,
  getCampaignPerformance,
  getDailySeries,
  getRecentCampaigns,
  getRecentTransactions,
  getSpend,
  getStatusTotals,
  type DailyPoint,
  type StatusTotals,
} from "./queries";

/**
 * Everything the dashboard home renders. One backend per request: Laravel's GET /app/dashboard
 * (LARAVEL_FEATURES `dashboard`) or the Prisma queries — same numbers, same shapes.
 */
export interface DashboardData {
  totals: StatusTotals;
  daily: DailyPoint[];
  spend: { charged: Decimal; refunded: Decimal; net: Decimal } | null;
  balance: { balance: Decimal; lowBalanceThreshold: Decimal; credits: number; maskingCredits: number; rate: Decimal; planName: string } | null;
  recent: Array<{
    id: string;
    name: string;
    status: CampaignStatus;
    recipientCount: number;
    deliveredCount: number;
    failedCount: number;
    submittedCount: number;
    scheduledAt: Date | null;
    createdAt: Date;
    smsType: SmsType;
  }>;
  perf: Array<{ id: string; name: string; deliveredCount: number; failedCount: number; submittedCount: number; recipientCount: number }>;
  txns: Array<{ id: string; type: WalletTxType; description: string; amount: Decimal; createdAt: Date }>;
}

export async function loadDashboard(ctx: TenantContext, range: DateRange, canBilling: boolean): Promise<DashboardData> {
  if (laravelEnabled("dashboard")) return loadFromLaravel(range);
  const [totals, daily, spend, balance, recent, perf, txns] = await Promise.all([
    getStatusTotals(ctx, range),
    getDailySeries(ctx, range),
    canBilling ? getSpend(ctx, range) : null,
    canBilling ? getBalanceSummary(ctx) : null,
    getRecentCampaigns(ctx, 5),
    getCampaignPerformance(ctx, range, 6),
    canBilling ? getRecentTransactions(ctx, 5) : [],
  ]);
  return { totals, daily, spend, balance, recent, perf, txns };
}

interface LaravelDashboard {
  totals: StatusTotals;
  daily: Array<{ day: string; delivered: number; failed: number; pending: number; spend: string }>;
  spend: { charged: string; refunded: string; net: string } | null;
  balance: { balance: string; lowBalanceThreshold: string; credits: number; maskingCredits: number; rate: string; planName: string } | null;
  recentCampaigns: Array<Omit<DashboardData["recent"][number], "scheduledAt" | "createdAt"> & { scheduledAt: string | null; createdAt: string }>;
  campaignPerformance: DashboardData["perf"];
  recentTransactions: Array<{ id: string; type: WalletTxType; description: string; amount: string; createdAt: string }>;
}

async function loadFromLaravel(range: DateRange): Promise<DashboardData> {
  const d = await laravelData<LaravelDashboard>("app/dashboard", rangeToQuery(range));
  const { delivered, failed } = d.totals;
  return {
    // Laravel rounds the rate to 4 dp; recompute from the counts so the 1-dp display is identical.
    totals: { ...d.totals, deliveryRate: delivered + failed > 0 ? delivered / (delivered + failed) : null },
    daily: d.daily.map((p) => ({ day: p.day, delivered: p.delivered, failed: p.failed, pending: p.pending, spend: Number(p.spend) })),
    spend: d.spend ? { charged: dec(d.spend.charged), refunded: dec(d.spend.refunded), net: dec(d.spend.net) } : null,
    balance: d.balance
      ? {
          balance: dec(d.balance.balance),
          lowBalanceThreshold: dec(d.balance.lowBalanceThreshold),
          credits: d.balance.credits,
          maskingCredits: d.balance.maskingCredits,
          rate: dec(d.balance.rate),
          planName: d.balance.planName,
        }
      : null,
    recent: d.recentCampaigns.map((c) => ({ ...c, scheduledAt: date(c.scheduledAt), createdAt: date(c.createdAt) })),
    perf: d.campaignPerformance,
    txns: d.recentTransactions.map((t) => ({ id: t.id, type: t.type, description: t.description, amount: dec(t.amount), createdAt: date(t.createdAt) })),
  };
}
