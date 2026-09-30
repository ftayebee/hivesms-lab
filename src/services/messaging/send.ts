import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { MessageSource, SenderType, SmsType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertOrgActive, actorOf, type TenantContext } from "@/lib/auth/context";
import { audit } from "@/lib/audit";
import { detectOperator, normalizeBdPhone } from "@/lib/phone";
import { calculateSegments, renderTemplate } from "@/lib/sms-segments";
import { messageCost, rateFor } from "@/lib/pricing";
import { getSmsPolicy } from "@/services/settings";
import { getOrganizationPlan } from "@/services/billing/pricing";
import { debitWallet } from "@/services/billing/wallet";
import { evaluateMessageRisk } from "@/services/risk";
import {
  assertContentAllowed,
  assertNotQuietHours,
  assertWithinSendingLimits,
  blockedNumbers,
  isWithinQuietHours,
  lockWallet,
  suppressedNumbers,
} from "./compliance";
import { checkLowBalance } from "./low-balance";

export interface ResolvedSender {
  value: string;
  type: SenderType;
  id: string | null;
}

/**
 * Resolves the sender for a send. An explicit sender must be an APPROVED sender ID of this
 * organization. Without one, the organization's default approved sender is used, falling back
 * to the platform's shared non-masking number.
 */
export async function resolveSender(organizationId: string, requested?: string | null): Promise<ResolvedSender> {
  if (requested) {
    const s = await db.senderId.findFirst({ where: { organizationId, value: requested } });
    if (!s || s.status !== "APPROVED") {
      throw new AppError("SENDER_ID_NOT_APPROVED", `Sender ID "${requested}" is not approved for this account.`);
    }
    return { value: s.value, type: s.type, id: s.id };
  }
  const def = await db.senderId.findFirst({ where: { organizationId, status: "APPROVED", isDefault: true } });
  if (def) return { value: def.value, type: def.type, id: def.id };
  const platformDefault = process.env.SMS_DEFAULT_SENDER_ID;
  if (!platformDefault) throw new AppError("SENDER_ID_NOT_APPROVED", "No sender ID is available. Request a sender ID first.");
  return { value: platformDefault, type: "NON_MASKING", id: null };
}

export interface SendRecipient {
  phone: string;
  /** Per-recipient message override (bulk API). */
  message?: string;
  variables?: Record<string, string | null | undefined>;
}

export interface SendRequest {
  recipients: SendRecipient[];
  message: string;
  senderId?: string | null;
  smsType: SmsType;
  source: MessageSource;
  clientReference?: string | null;
  /** Deliver later (up to 30 days ahead). */
  scheduledAt?: Date | null;
  /** Mode "single": any invalid recipient fails the whole request. */
  mode: "single" | "bulk";
}

export interface AcceptedMessage {
  id: string;
  to: string;
  status: "QUEUED";
  segments: number;
  encoding: "GSM7" | "UCS2";
  cost: string;
}

export interface RejectedRecipient {
  to: string;
  code: string;
  reason: string;
}

export interface SendResult {
  batchId: string;
  accepted: AcceptedMessage[];
  rejected: RejectedRecipient[];
  totalCost: string;
  totalSegments: number;
  scheduledAt: string | null;
}

const MAX_SCHEDULE_DAYS = 30;

export async function sendMessages(ctx: TenantContext, req: SendRequest): Promise<SendResult> {
  assertOrgActive(ctx);
  const policy = await getSmsPolicy();
  if (!req.recipients.length) throw new AppError("VALIDATION_ERROR", "At least one recipient is required.");
  if (req.recipients.length > policy.maxBulkRecipients) {
    throw new AppError("VALIDATION_ERROR", `A single request can include at most ${policy.maxBulkRecipients} recipients. Use a campaign for larger sends.`);
  }
  if (req.scheduledAt) {
    const ms = req.scheduledAt.getTime() - Date.now();
    if (ms < -60_000) throw new AppError("VALIDATION_ERROR", "scheduled_at must be in the future.");
    if (ms > MAX_SCHEDULE_DAYS * 86_400_000) throw new AppError("VALIDATION_ERROR", `scheduled_at can be at most ${MAX_SCHEDULE_DAYS} days ahead.`);
  }
  if (req.smsType === "PROMOTIONAL") assertNotQuietHours(policy, req.scheduledAt ?? new Date());

  await assertContentAllowed(req.message);
  const sender = await resolveSender(ctx.organizationId, req.senderId);
  const plan = await getOrganizationPlan(ctx.organizationId);
  const rate = rateFor(plan, req.smsType, sender.type);

  const rejected: RejectedRecipient[] = [];
  const reject = (to: string, code: string, reason: string) => {
    if (req.mode === "single") throw new AppError(code as never, reason);
    rejected.push({ to, code, reason });
  };

  // Normalise, dedupe and validate recipients.
  const seen = new Set<string>();
  const candidates: { to: string; body: string }[] = [];
  for (const r of req.recipients) {
    const to = normalizeBdPhone(r.phone);
    if (!to) {
      reject(String(r.phone), "INVALID_RECIPIENT", "Not a valid Bangladesh mobile number.");
      continue;
    }
    if (seen.has(to)) continue;
    seen.add(to);
    const template = r.message ?? req.message;
    if (r.message && r.message !== req.message) await assertContentAllowed(r.message);
    const body = r.variables ? renderTemplate(template, r.variables) : template;
    if (!body.trim()) {
      reject(to, "VALIDATION_ERROR", "Message is empty.");
      continue;
    }
    candidates.push({ to, body });
  }

  const phones = candidates.map((c) => c.to);
  const blocked = await blockedNumbers(phones);
  const suppressed = req.smsType === "PROMOTIONAL" ? await suppressedNumbers(ctx.organizationId, phones) : new Set<string>();

  const rows: Prisma.MessageCreateManyInput[] = [];
  const accepted: AcceptedMessage[] = [];
  let total = new Decimal(0);
  let totalSegments = 0;
  const now = new Date();

  for (const c of candidates) {
    if (blocked.has(c.to)) {
      reject(c.to, "INVALID_RECIPIENT", "This number is blocked on the platform.");
      continue;
    }
    if (suppressed.has(c.to)) {
      reject(c.to, "RECIPIENT_SUPPRESSED", "Recipient has opted out of promotional messages.");
      continue;
    }
    const seg = calculateSegments(c.body, policy.segmentation);
    if (seg.exceedsMax) {
      reject(c.to, "MESSAGE_TOO_LONG", `Message needs ${seg.segments} segments; the maximum is ${policy.segmentation.maxSegments}.`);
      continue;
    }
    const cost = messageCost(seg.segments, 1, rate);
    const id = randomUUID();
    rows.push({
      id,
      organizationId: ctx.organizationId,
      apiKeyId: ctx.apiKeyId,
      source: req.source,
      to: c.to,
      operator: detectOperator(c.to),
      senderValue: sender.value,
      senderType: sender.type,
      smsType: req.smsType,
      body: c.body,
      encoding: seg.encoding,
      segments: seg.segments,
      unitPrice: rate.toString(),
      cost: cost.toString(),
      clientReference: req.clientReference ?? null,
      nextAttemptAt: req.scheduledAt ?? now,
      queuedAt: now,
    });
    accepted.push({ id, to: c.to, status: "QUEUED", segments: seg.segments, encoding: seg.encoding, cost: cost.toFixed(2) });
    total = total.plus(cost);
    totalSegments += seg.segments;
  }

  if (!rows.length) {
    throw new AppError("VALIDATION_ERROR", "No valid recipients to send to.", { rejected });
  }

  // Risk review: large promotional API/dashboard sends with risky content must go through a
  // reviewed campaign instead.
  const org = await db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { createdAt: true } });
  const risk = evaluateMessageRisk({
    message: req.message,
    smsType: req.smsType,
    recipientCount: rows.length,
    organizationAgeDays: (Date.now() - org.createdAt.getTime()) / 86_400_000,
  });
  if (risk.action === "review") {
    await audit({ action: "risk.flagged", actor: actorOf(ctx), organizationId: ctx.organizationId, metadata: { reasons: risk.reasons, recipients: rows.length, source: req.source } });
    if (req.smsType === "PROMOTIONAL" && rows.length > 1) {
      throw new AppError("CONTENT_BLOCKED", "This message needs review before sending. Create a campaign so our team can review it.", { reasons: risk.reasons });
    }
  }

  const batchId = randomUUID();
  await db.$transaction(
    async (tx) => {
      await lockWallet(tx, ctx.organizationId);
      await assertWithinSendingLimits(tx, ctx.organizationId, rows.length);
      await debitWallet(tx, {
        organizationId: ctx.organizationId,
        amount: total,
        reason: "SMS_CHARGE",
        description: rows.length === 1 ? `SMS to ${rows[0].to}` : `SMS batch (${rows.length} recipients)`,
        referenceType: "send_batch",
        referenceId: batchId,
        createdById: ctx.userId,
      });
      await tx.message.createMany({ data: rows });
    },
    { timeout: 20_000 },
  );

  await audit({
    action: "sms.send",
    actor: actorOf(ctx),
    organizationId: ctx.organizationId,
    targetType: "send_batch",
    targetId: batchId,
    ip: ctx.ip,
    metadata: { recipients: rows.length, rejected: rejected.length, smsType: req.smsType, source: req.source, cost: total.toFixed(2) },
  });
  await checkLowBalance(ctx.organizationId);

  return {
    batchId,
    accepted,
    rejected,
    totalCost: total.toFixed(2),
    totalSegments,
    scheduledAt: req.scheduledAt?.toISOString() ?? null,
  };
}

export { isWithinQuietHours };
