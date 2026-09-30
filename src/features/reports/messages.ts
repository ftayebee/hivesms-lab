import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, requirePermission, type TenantContext } from "@/lib/auth/context";
import { normalizeBdPhone } from "@/lib/phone";
import { toCsv } from "@/lib/csv";
import type { DateRange } from "./range";
import type { MessageFilters } from "./queries";

export const REPORT_PAGE_SIZE = 25;

export const reportFiltersSchema = z.object({
  campaign: z.uuid().optional().catch(undefined),
  sender: z.string().trim().max(20).optional().catch(undefined),
  status: z.enum(["QUEUED", "SUBMITTED", "DELIVERED", "FAILED", "REJECTED", "EXPIRED", "CANCELLED"]).optional().catch(undefined),
  recipient: z.string().trim().max(30).optional().catch(undefined),
  source: z.enum(["API", "CAMPAIGN", "DASHBOARD"]).optional().catch(undefined),
});

export function toMessageFilters(f: z.infer<typeof reportFiltersSchema>): MessageFilters {
  return {
    campaignId: f.campaign,
    senderValue: f.sender || undefined,
    status: f.status,
    to: f.recipient ? (normalizeBdPhone(f.recipient) ?? f.recipient) : undefined,
    source: f.source,
  };
}

function where(ctx: TenantContext, range: DateRange, f: MessageFilters): Prisma.MessageWhereInput {
  return {
    organizationId: ctx.organizationId,
    createdAt: { gte: range.from, lt: range.to },
    ...(f.campaignId ? { campaignId: f.campaignId } : {}),
    ...(f.senderValue ? { senderValue: f.senderValue } : {}),
    ...(f.status ? { status: f.status } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.source ? { source: f.source } : {}),
  };
}

export async function listMessages(ctx: TenantContext, range: DateRange, f: MessageFilters, page: number) {
  requirePermission(ctx, "reports:read");
  const w = where(ctx, range, f);
  const [rows, total] = await Promise.all([
    db.message.findMany({
      where: w,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * REPORT_PAGE_SIZE,
      take: REPORT_PAGE_SIZE,
      select: { id: true, to: true, status: true, senderValue: true, smsType: true, source: true, segments: true, cost: true, createdAt: true, errorMessage: true, campaign: { select: { id: true, name: true } } },
    }),
    db.message.count({ where: w }),
  ]);
  return { rows, total };
}

export async function getMessage(ctx: TenantContext, id: string) {
  requirePermission(ctx, "reports:read");
  const m = await db.message.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: { events: { orderBy: { occurredAt: "asc" } }, campaign: { select: { id: true, name: true } }, apiKey: { select: { name: true, prefix: true } } },
  });
  if (!m) throw notFound("Message");
  return m;
}

export async function exportMessagesCsv(ctx: TenantContext, range: DateRange, f: MessageFilters) {
  requirePermission(ctx, "reports:export");
  const rows = await db.message.findMany({ where: where(ctx, range, f), orderBy: { createdAt: "desc" }, take: 250_000, include: { campaign: { select: { name: true } } } });
  const csv = toCsv(
    ["created_at", "phone", "status", "type", "source", "sender_id", "campaign", "segments", "encoding", "cost_bdt", "refunded", "operator", "error", "submitted_at", "delivered_at", "failed_at", "reference", "message_id"],
    rows.map((m) => [
      m.createdAt,
      m.to,
      m.status,
      m.smsType,
      m.source,
      m.senderValue,
      m.campaign?.name,
      m.segments,
      m.encoding,
      m.cost.toFixed(2),
      m.refundedAt ? "yes" : "no",
      m.operator,
      m.errorMessage,
      m.submittedAt,
      m.deliveredAt,
      m.failedAt,
      m.clientReference,
      m.id,
    ]),
  );
  await audit({ action: "report.export", actor: actorOf(ctx), organizationId: ctx.organizationId, metadata: { rows: rows.length, from: range.from.toISOString(), to: range.to.toISOString() } });
  return csv;
}
