import { Decimal } from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import type { CampaignStatus, MessageStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, assertOrgActive, requirePermission, type TenantContext } from "@/lib/auth/context";
import { calculateSegments } from "@/lib/sms-segments";
import { dhakaLocalInputToDate, formatDateTime } from "@/lib/format";
import { toCsv } from "@/lib/csv";
import { getSmsPolicy } from "@/services/settings";
import { getBalance } from "@/services/billing/wallet";
import { evaluateMessageRisk } from "@/services/risk";
import { assertContentAllowed, assertNotQuietHours } from "@/services/messaging/compliance";
import { estimateCampaign, type CampaignAudience } from "@/services/messaging/campaign-runner";
import { resolveSender } from "@/services/messaging/send";
import { applyStatusUpdate } from "@/services/messaging/delivery";
import type { ComposerInput } from "./schemas";

export const CAMPAIGNS_PAGE_SIZE = 20;
const MAX_PASTED_NUMBERS = 100_000;

function splitNumbers(raw: string) {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_PASTED_NUMBERS);
}

async function ownedGroups(ctx: TenantContext, ids: string[]) {
  if (!ids.length) return [];
  const groups = await db.contactGroup.findMany({ where: { id: { in: ids }, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true } });
  if (groups.length !== new Set(ids).size) throw new AppError("VALIDATION_ERROR", "One or more selected groups were not found.", { field: "groupIds" });
  return groups.map((g) => g.id);
}

function autoName(input: ComposerInput) {
  return input.name.trim() || `${input.smsType === "PROMOTIONAL" ? "Promotion" : "Message"} ${formatDateTime(new Date())}`;
}

async function loadEditable(ctx: TenantContext, id: string) {
  const c = await db.campaign.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null } });
  if (!c) throw notFound("Campaign");
  if (c.status !== "DRAFT") throw new AppError("CONFLICT", "Only draft campaigns can be edited.");
  return c;
}

/** Saves a draft (partial content allowed). */
export async function saveDraft(ctx: TenantContext, input: ComposerInput) {
  requirePermission(ctx, "campaigns:write");
  if (input.id) await loadEditable(ctx, input.id);
  const groupIds = await ownedGroups(ctx, input.groupIds);
  const policy = await getSmsPolicy();
  const sender = input.senderId ? await resolveSender(ctx.organizationId, input.senderId) : await resolveSender(ctx.organizationId, null);
  const seg = calculateSegments(input.message, policy.segmentation);
  const scheduledAt = input.scheduleMode === "later" ? dhakaLocalInputToDate(input.scheduledAt) : null;
  const data = {
    name: autoName(input),
    smsType: input.smsType,
    senderIdId: sender.id,
    senderValue: sender.value,
    senderType: sender.type,
    templateId: input.templateId ?? null,
    message: input.message,
    encoding: seg.encoding,
    segmentsPerMessage: Math.max(1, seg.segments),
    audience: { groupIds, numbers: splitNumbers(input.numbers) } as Prisma.InputJsonValue,
    scheduledAt,
  };
  const c = input.id
    ? await db.campaign.update({ where: { id: input.id }, data })
    : await db.campaign.create({ data: { ...data, organizationId: ctx.organizationId, status: "DRAFT", createdById: ctx.userId } });
  if (!input.id) await audit({ action: "campaign.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "campaign", targetId: c.id });
  return c;
}

export interface CampaignEstimate {
  total: number;
  included: number;
  skipped: number;
  segments: number;
  encoding: "GSM7" | "UCS2";
  rate: string;
  estimatedCost: string;
  balance: string;
  sufficientBalance: boolean;
  requiresReview: boolean;
  reviewReasons: string[];
  senderValue: string;
  senderType: "MASKING" | "NON_MASKING";
  scheduledAt: string | null;
}

async function validateForSend(ctx: TenantContext, input: ComposerInput) {
  const policy = await getSmsPolicy();
  if (!input.message.trim()) throw new AppError("VALIDATION_ERROR", "Write a message.", { field: "message" });
  const seg = calculateSegments(input.message, policy.segmentation);
  if (seg.exceedsMax) throw new AppError("MESSAGE_TOO_LONG", `The message needs ${seg.segments} segments; the maximum is ${policy.segmentation.maxSegments}.`, { field: "message" });
  await assertContentAllowed(input.message);
  const groupIds = await ownedGroups(ctx, input.groupIds);
  const numbers = splitNumbers(input.numbers);
  if (!groupIds.length && !numbers.length) throw new AppError("VALIDATION_ERROR", "Add recipients: select a group or enter numbers.", { field: "numbers" });

  let scheduledAt: Date | null = null;
  if (input.scheduleMode === "later") {
    scheduledAt = dhakaLocalInputToDate(input.scheduledAt);
    if (!scheduledAt) throw new AppError("VALIDATION_ERROR", "Choose a date and time.", { field: "scheduledAt" });
    if (scheduledAt.getTime() < Date.now() + 60_000) throw new AppError("VALIDATION_ERROR", "Choose a time at least one minute in the future.", { field: "scheduledAt" });
    if (scheduledAt.getTime() > Date.now() + 90 * 86_400_000) throw new AppError("VALIDATION_ERROR", "Schedule at most 90 days ahead.", { field: "scheduledAt" });
  }
  if (input.smsType === "PROMOTIONAL") assertNotQuietHours(policy, scheduledAt ?? new Date());
  const sender = await resolveSender(ctx.organizationId, input.senderId || null);
  const audience: CampaignAudience = { groupIds, numbers };
  const est = await estimateCampaign(ctx.organizationId, { message: input.message, smsType: input.smsType, senderType: sender.type, audience });
  if (est.included === 0) throw new AppError("VALIDATION_ERROR", "None of the recipients can receive this message (all invalid, blocked or opted out).", { field: "numbers" });
  if (est.total > policy.maxCampaignRecipients) throw new AppError("VALIDATION_ERROR", `Campaigns are limited to ${policy.maxCampaignRecipients.toLocaleString("en-US")} recipients.`);

  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { requireCampaignReview: true, createdAt: true } });
  const risk = evaluateMessageRisk({ message: input.message, smsType: input.smsType, recipientCount: est.included, organizationAgeDays: (Date.now() - org.createdAt.getTime()) / 86_400_000 });
  const reviewReasons = [...risk.reasons];
  if (org.requireCampaignReview && (input.smsType === "PROMOTIONAL" || est.included > 50)) reviewReasons.push("Your account's campaigns are reviewed before sending");
  if (est.included > policy.reviewThresholdRecipients) reviewReasons.push(`More than ${policy.reviewThresholdRecipients.toLocaleString("en-US")} recipients`);
  const balance = await getBalance(ctx.organizationId);
  return { seg, sender, audience, est, scheduledAt, reviewReasons, balance };
}

export async function estimateComposer(ctx: TenantContext, input: ComposerInput): Promise<CampaignEstimate> {
  requirePermission(ctx, ["campaigns:write", "sms:send"]);
  const v = await validateForSend(ctx, input);
  return {
    total: v.est.total,
    included: v.est.included,
    skipped: v.est.skipped,
    segments: v.est.segments,
    encoding: v.est.encoding,
    rate: v.est.rate,
    estimatedCost: v.est.estimatedCost,
    balance: v.balance.toFixed(2),
    sufficientBalance: v.balance.gte(new Decimal(v.est.estimatedCost)),
    requiresReview: v.reviewReasons.length > 0,
    reviewReasons: v.reviewReasons,
    senderValue: v.sender.value,
    senderType: v.sender.type,
    scheduledAt: v.scheduledAt?.toISOString() ?? null,
  };
}

/** Submits a campaign for sending: SCHEDULED (or PENDING_REVIEW when review is required). */
export async function submitCampaign(ctx: TenantContext, input: ComposerInput) {
  requirePermission(ctx, ["campaigns:write", "sms:send"]);
  assertOrgActive(ctx);
  if (input.id) await loadEditable(ctx, input.id);
  const v = await validateForSend(ctx, input);
  if (v.balance.lt(new Decimal(v.est.estimatedCost))) {
    throw new AppError("INSUFFICIENT_BALANCE", `This campaign needs about BDT ${v.est.estimatedCost}; your balance is BDT ${v.balance.toFixed(2)}. Add balance and try again.`);
  }
  const status: CampaignStatus = v.reviewReasons.length ? "PENDING_REVIEW" : "SCHEDULED";
  const data = {
    name: autoName(input),
    smsType: input.smsType,
    senderIdId: v.sender.id,
    senderValue: v.sender.value,
    senderType: v.sender.type,
    templateId: input.templateId ?? null,
    message: input.message,
    encoding: v.seg.encoding,
    segmentsPerMessage: v.seg.segments,
    audience: v.audience as unknown as Prisma.InputJsonValue,
    scheduledAt: v.scheduledAt,
    status,
    estimatedCost: v.est.estimatedCost,
    recipientCount: v.est.included,
    reviewNote: v.reviewReasons.length ? v.reviewReasons.join("; ") : null,
  };
  const c = input.id
    ? await db.campaign.update({ where: { id: input.id }, data })
    : await db.campaign.create({ data: { ...data, organizationId: ctx.organizationId, createdById: ctx.userId } });
  await audit({
    action: status === "PENDING_REVIEW" ? "campaign.submit_for_review" : "campaign.schedule",
    actor: actorOf(ctx),
    organizationId: ctx.organizationId,
    targetType: "campaign",
    targetId: c.id,
    metadata: { recipients: v.est.included, estimatedCost: v.est.estimatedCost, scheduledAt: v.scheduledAt?.toISOString() ?? null, reasons: v.reviewReasons },
  });
  return { campaign: c, launchNow: status === "SCHEDULED" && !v.scheduledAt };
}

async function getOwned(ctx: TenantContext, id: string) {
  const c = await db.campaign.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null } });
  if (!c) throw notFound("Campaign");
  return c;
}

export async function pauseCampaign(ctx: TenantContext, id: string) {
  requirePermission(ctx, "campaigns:write");
  await getOwned(ctx, id);
  const r = await db.campaign.updateMany({ where: { id, status: "PROCESSING" }, data: { status: "PAUSED", pausedAt: new Date() } });
  if (!r.count) throw new AppError("CONFLICT", "Only campaigns that are sending can be paused.");
  await audit({ action: "campaign.pause", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "campaign", targetId: id });
}

export async function resumeCampaign(ctx: TenantContext, id: string) {
  requirePermission(ctx, "campaigns:write");
  assertOrgActive(ctx);
  await getOwned(ctx, id);
  const r = await db.campaign.updateMany({ where: { id, status: "PAUSED" }, data: { status: "PROCESSING", pausedAt: null } });
  if (!r.count) throw new AppError("CONFLICT", "Only paused campaigns can be resumed.");
  await audit({ action: "campaign.resume", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "campaign", targetId: id });
}

export async function cancelCampaign(ctx: TenantContext, id: string) {
  requirePermission(ctx, "campaigns:write");
  const c = await getOwned(ctx, id);
  const r = await db.campaign.updateMany({
    where: { id, status: { in: ["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PROCESSING", "PAUSED"] } },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (!r.count) throw new AppError("CONFLICT", `A ${c.status.toLowerCase()} campaign cannot be cancelled.`);
  await audit({ action: "campaign.cancel", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "campaign", targetId: id, metadata: { from: c.status } });
  // Unsent messages are cancelled and refunded; large remainders are finished by the worker.
  await cancelQueuedMessages(id, 500);
}

/** Cancels (and refunds) still-queued messages of a cancelled campaign. Returns how many remain. */
export async function cancelQueuedMessages(campaignId: string, limit: number) {
  const queued = await db.message.findMany({ where: { campaignId, status: "QUEUED" }, select: { id: true }, take: limit });
  for (const m of queued) {
    await applyStatusUpdate({ messageId: m.id, status: "CANCELLED", source: "SYSTEM", dedupeKey: `cancel:${m.id}`, description: "Campaign cancelled" });
  }
  return db.message.count({ where: { campaignId, status: "QUEUED" } });
}

export async function duplicateCampaign(ctx: TenantContext, id: string) {
  requirePermission(ctx, "campaigns:write");
  const c = await getOwned(ctx, id);
  const copy = await db.campaign.create({
    data: {
      organizationId: ctx.organizationId,
      name: `${c.name} (copy)`.slice(0, 120),
      smsType: c.smsType,
      senderIdId: c.senderIdId,
      senderValue: c.senderValue,
      senderType: c.senderType,
      templateId: c.templateId,
      message: c.message,
      encoding: c.encoding,
      segmentsPerMessage: c.segmentsPerMessage,
      audience: c.audience as Prisma.InputJsonValue,
      status: "DRAFT",
      createdById: ctx.userId,
    },
  });
  await audit({ action: "campaign.duplicate", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "campaign", targetId: copy.id, metadata: { from: id } });
  return copy;
}

export async function deleteDraft(ctx: TenantContext, id: string) {
  requirePermission(ctx, "campaigns:write");
  const c = await getOwned(ctx, id);
  if (!["DRAFT", "CANCELLED"].includes(c.status)) throw new AppError("CONFLICT", "Only drafts and cancelled campaigns can be deleted.");
  await db.campaign.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ action: "campaign.delete", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "campaign", targetId: id });
}

// ─── Queries ───

export async function listCampaigns(ctx: TenantContext, q: { q?: string; status?: CampaignStatus; type?: "TRANSACTIONAL" | "PROMOTIONAL"; page: number }) {
  requirePermission(ctx, "campaigns:read");
  const where: Prisma.CampaignWhereInput = {
    organizationId: ctx.organizationId,
    deletedAt: null,
    ...(q.q ? { name: { contains: q.q } } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.type ? { smsType: q.type } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    db.campaign.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * CAMPAIGNS_PAGE_SIZE, take: CAMPAIGNS_PAGE_SIZE }),
    db.campaign.count({ where }),
    db.campaign.groupBy({ by: ["status"], where: { organizationId: ctx.organizationId, deletedAt: null }, _count: true }),
  ]);
  return { rows, total, statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<CampaignStatus, number>> };
}

export async function getCampaignDetail(ctx: TenantContext, id: string) {
  requirePermission(ctx, "campaigns:read");
  const c = await db.campaign.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null }, include: { template: { select: { name: true } } } });
  if (!c) throw notFound("Campaign");
  const [statusRows, failures, operators, timeline, recipientSkips, creator] = await Promise.all([
    db.message.groupBy({ by: ["status"], where: { campaignId: id }, _count: true }),
    db.$queryRaw<{ reason: string; n: bigint }[]>`
      SELECT COALESCE(errorMessage, 'Unknown') AS reason, COUNT(*) AS n FROM messages
      WHERE campaignId = ${id} AND status IN ('FAILED','REJECTED','EXPIRED','CANCELLED') GROUP BY 1 ORDER BY n DESC LIMIT 8`,
    db.$queryRaw<{ operator: string | null; total: bigint; delivered: bigint }[]>`
      SELECT operator, COUNT(*) AS total, COUNT(CASE WHEN status = 'DELIVERED' THEN 1 END) AS delivered FROM messages
      WHERE campaignId = ${id} GROUP BY operator ORDER BY total DESC`,
    db.auditLog.findMany({ where: { organizationId: ctx.organizationId, targetType: "campaign", targetId: id }, orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } } }),
    db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: id, status: { not: "INCLUDED" } }, _count: true }),
    c.createdById ? db.user.findUnique({ where: { id: c.createdById }, select: { name: true } }) : null,
  ]);
  const by = (s: MessageStatus[]) => statusRows.filter((r) => s.includes(r.status)).reduce((a, r) => a + r._count, 0);
  return {
    campaign: c,
    createdBy: creator?.name ?? null,
    stats: {
      queued: by(["QUEUED"]),
      sent: by(["SUBMITTED"]),
      delivered: by(["DELIVERED"]),
      failed: by(["FAILED", "REJECTED", "EXPIRED", "CANCELLED"]),
      total: statusRows.reduce((a, r) => a + r._count, 0),
    },
    skipped: Object.fromEntries(recipientSkips.map((r) => [r.status, r._count])) as Record<string, number>,
    failures: failures.map((f) => ({ reason: f.reason, count: Number(f.n) })),
    operators: operators.map((o) => ({ operator: o.operator ?? "Unknown", total: Number(o.total), delivered: Number(o.delivered) })),
    timeline: timeline.map((t) => ({ id: t.id, action: t.action, at: t.createdAt, actor: t.actor?.name ?? (t.actorType === "SYSTEM" ? "System" : t.actorType === "ADMIN" ? "Review team" : null), metadata: t.metadata as Record<string, unknown> })),
  };
}

export async function listCampaignMessages(ctx: TenantContext, id: string, opts: { status?: MessageStatus; page: number; pageSize: number }) {
  requirePermission(ctx, "campaigns:read");
  const where: Prisma.MessageWhereInput = { organizationId: ctx.organizationId, campaignId: id, ...(opts.status ? { status: opts.status } : {}) };
  const [rows, total] = await Promise.all([
    db.message.findMany({ where, orderBy: { createdAt: "asc" }, skip: (opts.page - 1) * opts.pageSize, take: opts.pageSize, select: { id: true, to: true, status: true, segments: true, cost: true, errorMessage: true, submittedAt: true, deliveredAt: true, failedAt: true, operator: true, refundedAt: true } }),
    db.message.count({ where }),
  ]);
  return { rows, total };
}

export async function exportCampaignReport(ctx: TenantContext, id: string) {
  requirePermission(ctx, "reports:export");
  const c = await getOwned(ctx, id);
  const [messages, skipped] = await Promise.all([
    db.message.findMany({ where: { campaignId: id, organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" }, take: 250_000 }),
    db.campaignRecipient.findMany({ where: { campaignId: id, status: { not: "INCLUDED" } }, take: 250_000 }),
  ]);
  const csv = toCsv(
    ["phone", "status", "operator", "segments", "cost_bdt", "refunded", "error", "queued_at", "submitted_at", "delivered_at", "failed_at", "message_id"],
    [
      ...messages.map((m) => [m.to, m.status, m.operator, m.segments, m.cost.toFixed(2), m.refundedAt ? "yes" : "no", m.errorMessage, m.queuedAt, m.submittedAt, m.deliveredAt, m.failedAt, m.id]),
      ...skipped.map((s) => [s.phone, s.status, "", 0, "0.00", "no", "Not sent", "", "", "", "", ""]),
    ],
  );
  await audit({ action: "campaign.export", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "campaign", targetId: id });
  return { csv, name: c.name };
}
