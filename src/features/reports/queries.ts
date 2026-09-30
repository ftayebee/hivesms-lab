import { Decimal } from "decimal.js";
import { Prisma } from "@/generated/prisma/client";
import type { MessageStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { TenantContext } from "@/lib/auth/context";
import { rateFor } from "@/lib/pricing";
import { dhakaDaySql } from "@/lib/sql";
import { getOrganizationPlan } from "@/services/billing/pricing";
import { dayKeys, type DateRange } from "./range";

/**
 * Reporting queries. All aggregation happens in the database and every query is scoped to the
 * tenant's organizationId. Days are bucketed in Asia/Dhaka.
 */
export interface StatusTotals {
  total: number;
  queued: number;
  sent: number; // submitted and not yet final
  delivered: number;
  failed: number; // failed + rejected + expired + cancelled
  pending: number; // queued + sent
  segments: number;
  deliveryRate: number | null; // delivered / (delivered + failed)
}

export interface MessageFilters {
  campaignId?: string;
  senderValue?: string;
  status?: MessageStatus;
  to?: string;
  source?: "API" | "CAMPAIGN" | "DASHBOARD";
}

function whereFor(ctx: TenantContext, range: DateRange, f: MessageFilters = {}): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`organizationId = ${ctx.organizationId}`,
    Prisma.sql`createdAt >= ${range.from}`,
    Prisma.sql`createdAt < ${range.to}`,
  ];
  if (f.campaignId) parts.push(Prisma.sql`campaignId = ${f.campaignId}`);
  if (f.senderValue) parts.push(Prisma.sql`senderValue = ${f.senderValue}`);
  if (f.status) parts.push(Prisma.sql`status = ${f.status}`);
  if (f.to) parts.push(Prisma.sql`\`to\` = ${f.to}`);
  if (f.source) parts.push(Prisma.sql`source = ${f.source}`);
  return Prisma.join(parts, " AND ");
}

export async function getStatusTotals(ctx: TenantContext, range: DateRange, filters: MessageFilters = {}): Promise<StatusTotals> {
  const rows = await db.$queryRaw<{ status: MessageStatus; n: bigint; segs: bigint }[]>`
    SELECT status, COUNT(*) AS n, COALESCE(SUM(segments), 0) AS segs
    FROM messages WHERE ${whereFor(ctx, range, filters)} GROUP BY status`;
  const by = (s: MessageStatus[]) => rows.filter((r) => s.includes(r.status)).reduce((a, r) => a + Number(r.n), 0);
  const delivered = by(["DELIVERED"]);
  const failed = by(["FAILED", "REJECTED", "EXPIRED", "CANCELLED"]);
  const queued = by(["QUEUED"]);
  const sent = by(["SUBMITTED"]);
  return {
    total: rows.reduce((a, r) => a + Number(r.n), 0),
    queued,
    sent,
    delivered,
    failed,
    pending: queued + sent,
    segments: rows.reduce((a, r) => a + Number(r.segs), 0),
    deliveryRate: delivered + failed > 0 ? delivered / (delivered + failed) : null,
  };
}

export interface DailyPoint {
  day: string;
  delivered: number;
  failed: number;
  pending: number;
  spend: number;
}

export async function getDailySeries(ctx: TenantContext, range: DateRange, filters: MessageFilters = {}): Promise<DailyPoint[]> {
  const rows = await db.$queryRaw<{ day: string; delivered: bigint; failed: bigint; pending: bigint; spend: string }[]>`
    SELECT ${dhakaDaySql("createdAt")} AS day,
      COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered,
      COUNT(CASE WHEN status IN ('FAILED','REJECTED','EXPIRED','CANCELLED') THEN 1 END) AS failed,
      COUNT(CASE WHEN status IN ('QUEUED','SUBMITTED') THEN 1 END) AS pending,
      CAST(COALESCE(SUM(CASE WHEN refundedAt IS NULL THEN cost END), 0) AS CHAR) AS spend
    FROM messages WHERE ${whereFor(ctx, range, filters)}
    GROUP BY 1 ORDER BY 1`;
  const map = new Map(rows.map((r) => [r.day, r]));
  return dayKeys(range).map((day) => {
    const r = map.get(day);
    return {
      day,
      delivered: Number(r?.delivered ?? 0),
      failed: Number(r?.failed ?? 0),
      pending: Number(r?.pending ?? 0),
      spend: Number(new Decimal(r?.spend ?? "0").toFixed(2)),
    };
  });
}

/** Net SMS spend in the range: charges minus refunds from the ledger. */
export async function getSpend(ctx: TenantContext, range: DateRange) {
  const rows = await db.walletTransaction.groupBy({
    by: ["reason"],
    where: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.to }, reason: { in: ["SMS_CHARGE", "REFUND"] } },
    _sum: { amount: true },
  });
  const charge = new Decimal(rows.find((r) => r.reason === "SMS_CHARGE")?._sum.amount?.toString() ?? "0");
  const refund = new Decimal(rows.find((r) => r.reason === "REFUND")?._sum.amount?.toString() ?? "0");
  return { charged: charge, refunded: refund, net: charge.minus(refund) };
}

export async function getOperatorBreakdown(ctx: TenantContext, range: DateRange, filters: MessageFilters = {}) {
  const rows = await db.$queryRaw<{ operator: string | null; total: bigint; delivered: bigint }[]>`
    SELECT operator, COUNT(*) AS total, COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered
    FROM messages WHERE ${whereFor(ctx, range, filters)} GROUP BY operator ORDER BY total DESC`;
  return rows.map((r) => ({ operator: r.operator ?? "Unknown", total: Number(r.total), delivered: Number(r.delivered) }));
}

export async function getFailureReasons(ctx: TenantContext, range: DateRange, filters: MessageFilters = {}, limit = 6) {
  const rows = await db.$queryRaw<{ reason: string | null; n: bigint }[]>`
    SELECT COALESCE(errorMessage, 'Unknown') AS reason, COUNT(*) AS n
    FROM messages WHERE ${whereFor(ctx, range, filters)} AND status IN ('FAILED','REJECTED','EXPIRED','CANCELLED')
    GROUP BY 1 ORDER BY n DESC LIMIT ${limit}`;
  return rows.map((r) => ({ reason: r.reason ?? "Unknown", count: Number(r.n) }));
}

/** Balance plus how many single-segment SMS it covers at the org's cheapest applicable rate. */
export async function getBalanceSummary(ctx: TenantContext) {
  const [wallet, plan] = await Promise.all([db.wallet.findUnique({ where: { organizationId: ctx.organizationId } }), getOrganizationPlan(ctx.organizationId)]);
  const balance = new Decimal(wallet?.balance?.toString() ?? "0");
  const rate = rateFor(plan, "TRANSACTIONAL", "NON_MASKING");
  const maskRate = rateFor(plan, "TRANSACTIONAL", "MASKING");
  return {
    balance,
    lowBalanceThreshold: new Decimal(wallet?.lowBalanceThreshold?.toString() ?? "0"),
    credits: rate.gt(0) ? balance.div(rate).floor().toNumber() : 0,
    maskingCredits: maskRate.gt(0) ? balance.div(maskRate).floor().toNumber() : 0,
    rate,
    planName: plan.name,
  };
}

export async function getRecentCampaigns(ctx: TenantContext, take = 5) {
  return db.campaign.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, name: true, status: true, recipientCount: true, deliveredCount: true, failedCount: true, submittedCount: true, scheduledAt: true, createdAt: true, smsType: true },
  });
}

export async function getCampaignPerformance(ctx: TenantContext, range: DateRange, take = 6) {
  return db.campaign.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null, startedAt: { gte: range.from, lt: range.to }, status: { in: ["COMPLETED", "PROCESSING"] } },
    orderBy: { startedAt: "desc" },
    take,
    select: { id: true, name: true, deliveredCount: true, failedCount: true, submittedCount: true, recipientCount: true },
  });
}

export async function getRecentTransactions(ctx: TenantContext, take = 5) {
  return db.walletTransaction.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "desc" }, take });
}
