import { Decimal } from "decimal.js";
import { db } from "@/lib/db";
import { dhakaDateKey, startOfDhakaDay } from "@/lib/format";

const DAY = 86_400_000;

/** Platform-wide metrics for the admin overview. */
export async function getAdminOverview() {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * DAY);
  const d1 = new Date(now.getTime() - DAY);
  const today = startOfDhakaDay();
  const [users, activeUsers, orgs, suspendedOrgs, smsToday, sms30, failed24, revenue30, pendingSenders, pendingPayments, reviewCampaigns, openTickets, newAbuse, api24, newLeads, daily, revenueDaily] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { deletedAt: null, lastLoginAt: { gte: d30 } } }),
    db.organization.count({ where: { deletedAt: null } }),
    db.organization.count({ where: { deletedAt: null, status: "SUSPENDED" } }),
    db.message.count({ where: { createdAt: { gte: today } } }),
    db.message.count({ where: { createdAt: { gte: d30 } } }),
    db.message.count({ where: { failedAt: { gte: d1 }, status: { in: ["FAILED", "REJECTED", "EXPIRED"] } } }),
    db.payment.aggregate({ where: { status: "SUCCEEDED", completedAt: { gte: d30 } }, _sum: { amount: true, total: true } }),
    db.senderId.count({ where: { status: "PENDING" } }),
    db.payment.count({ where: { status: "AWAITING_VERIFICATION" } }),
    db.campaign.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
    db.supportTicket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.abuseReport.count({ where: { status: "NEW" } }),
    db.apiLog.count({ where: { createdAt: { gte: d1 } } }),
    db.contactRequest.count({ where: { status: "NEW" } }),
    db.$queryRaw<{ day: string; delivered: bigint; failed: bigint; pending: bigint }[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE status = 'DELIVERED') AS delivered,
        count(*) FILTER (WHERE status IN ('FAILED','REJECTED','EXPIRED','CANCELLED')) AS failed,
        count(*) FILTER (WHERE status IN ('QUEUED','SUBMITTED')) AS pending
      FROM messages WHERE "createdAt" >= ${d30} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ day: string; amount: string }[]>`
      SELECT to_char(("completedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day, sum(amount)::text AS amount
      FROM payments WHERE status = 'SUCCEEDED' AND "completedAt" >= ${d30} GROUP BY 1 ORDER BY 1`,
  ]);
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const revByDay = new Map(revenueDaily.map((d) => [d.day, Number(d.amount)]));
  const series = [];
  for (let t = startOfDhakaDay(new Date(now.getTime() - 29 * DAY)).getTime(); t <= now.getTime(); t += DAY) {
    const key = dhakaDateKey(new Date(t));
    const r = byDay.get(key);
    series.push({ day: key, delivered: Number(r?.delivered ?? 0), failed: Number(r?.failed ?? 0), pending: Number(r?.pending ?? 0), spend: revByDay.get(key) ?? 0 });
  }
  return {
    users,
    activeUsers,
    orgs,
    suspendedOrgs,
    smsToday,
    sms30,
    failed24,
    revenue30: new Decimal(revenue30._sum.amount?.toString() ?? "0"),
    collected30: new Decimal(revenue30._sum.total?.toString() ?? "0"),
    pendingSenders,
    pendingPayments,
    reviewCampaigns,
    openTickets,
    newAbuse,
    api24,
    newLeads,
    series,
  };
}
