import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { Prisma } from "@/generated/prisma/client";
import type { RecipientStatus, SmsType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { detectOperator, normalizeBdPhone } from "@/lib/phone";
import { calculateSegments, renderTemplate } from "@/lib/sms-segments";
import { messageCost, rateFor } from "@/lib/pricing";
import { formatBDT } from "@/lib/format";
import { getSmsPolicy } from "@/services/settings";
import { getOrganizationPlan } from "@/services/billing/pricing";
import { debitWallet } from "@/services/billing/wallet";
import { notify } from "@/services/notify";
import { emailTemplates } from "@/services/email/templates";
import { assertWithinSendingLimits, blockedNumbers, lockWallet, suppressedNumbers } from "./compliance";
import { enqueueWebhookEvent } from "./outbound-webhooks";
import { checkLowBalance } from "./low-balance";

export interface CampaignAudience {
  groupIds?: string[];
  numbers?: string[];
}

export interface AudienceMember {
  phone: string;
  contactId: string | null;
  variables: Record<string, string>;
  status: RecipientStatus;
}

/**
 * Expands groups + pasted numbers into a de-duplicated recipient list for one organization and
 * marks who must be skipped (suppressed/opted-out for promotional, blocked, invalid, duplicate).
 */
export async function resolveAudience(organizationId: string, audience: CampaignAudience, smsType: SmsType): Promise<AudienceMember[]> {
  const members: AudienceMember[] = [];
  const seen = new Set<string>();

  if (audience.groupIds?.length) {
    const contacts = await db.contact.findMany({
      where: { organizationId, deletedAt: null, groups: { some: { groupId: { in: audience.groupIds }, group: { organizationId, deletedAt: null } } } },
      select: { id: true, phone: true, name: true, company: true, email: true, consentStatus: true, customFields: true },
    });
    for (const c of contacts) {
      if (seen.has(c.phone)) continue;
      seen.add(c.phone);
      const custom = Object.fromEntries(Object.entries((c.customFields as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v ?? "")]));
      members.push({
        phone: c.phone,
        contactId: c.id,
        variables: { ...custom, name: c.name ?? "", company: c.company ?? "", email: c.email ?? "", phone: c.phone },
        status: smsType === "PROMOTIONAL" && c.consentStatus === "OPTED_OUT" ? "SKIPPED_SUPPRESSED" : "INCLUDED",
      });
    }
  }

  for (const raw of audience.numbers ?? []) {
    const phone = normalizeBdPhone(raw);
    if (!phone) {
      members.push({ phone: String(raw).slice(0, 32), contactId: null, variables: {}, status: "SKIPPED_INVALID" });
      continue;
    }
    if (seen.has(phone)) continue;
    seen.add(phone);
    members.push({ phone, contactId: null, variables: { phone }, status: "INCLUDED" });
  }

  const included = members.filter((m) => m.status === "INCLUDED").map((m) => m.phone);
  const [blocked, suppressed] = await Promise.all([
    blockedNumbers(included),
    smsType === "PROMOTIONAL" ? suppressedNumbers(organizationId, included) : Promise.resolve(new Set<string>()),
  ]);
  for (const m of members) {
    if (m.status !== "INCLUDED") continue;
    if (blocked.has(m.phone)) m.status = "SKIPPED_BLOCKED";
    else if (suppressed.has(m.phone)) m.status = "SKIPPED_SUPPRESSED";
  }
  return members;
}

/** Cost estimate before launch (personalised messages may vary slightly). */
export async function estimateCampaign(organizationId: string, input: { message: string; smsType: SmsType; senderType: "MASKING" | "NON_MASKING"; audience: CampaignAudience }) {
  const policy = await getSmsPolicy();
  const members = await resolveAudience(organizationId, input.audience, input.smsType);
  const included = members.filter((m) => m.status === "INCLUDED");
  const plan = await getOrganizationPlan(organizationId);
  const rate = rateFor(plan, input.smsType, input.senderType);
  const seg = calculateSegments(input.message, policy.segmentation);
  return {
    total: members.length,
    included: included.length,
    skipped: members.length - included.length,
    segments: seg.segments,
    encoding: seg.encoding,
    rate: rate.toFixed(4),
    estimatedCost: messageCost(seg.segments, included.length, rate).toFixed(2),
  };
}

/**
 * Launches a campaign: resolves the audience, charges the wallet once for the whole campaign,
 * and inserts recipients + queued messages. Runs when a scheduled campaign becomes due or when
 * an approved "send now" campaign is started.
 */
export async function launchCampaign(campaignId: string) {
  // Claim atomically so two workers never launch the same campaign.
  const claimed = await db.campaign.updateMany({
    where: { id: campaignId, status: "SCHEDULED", OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
    data: { status: "PROCESSING", startedAt: new Date() },
  });
  if (!claimed.count) return { launched: false as const };

  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  try {
    const policy = await getSmsPolicy();
    const org = await db.organization.findUniqueOrThrow({ where: { id: campaign.organizationId } });
    if (org.status !== "ACTIVE") throw new AppError("ACCOUNT_SUSPENDED", "Account is suspended.");
    if (campaign.senderIdId) {
      const sender = await db.senderId.findFirst({ where: { id: campaign.senderIdId, organizationId: org.id } });
      if (!sender || sender.status !== "APPROVED") throw new AppError("SENDER_ID_NOT_APPROVED", "The campaign's sender ID is no longer approved.");
    }

    const members = await resolveAudience(org.id, campaign.audience as CampaignAudience, campaign.smsType);
    if (members.length > policy.maxCampaignRecipients) {
      throw new AppError("VALIDATION_ERROR", `Campaigns are limited to ${policy.maxCampaignRecipients} recipients.`);
    }
    const plan = await getOrganizationPlan(org.id);
    const rate = rateFor(plan, campaign.smsType, campaign.senderType);

    const recipientRows: Prisma.CampaignRecipientCreateManyInput[] = [];
    const messageRows: Prisma.MessageCreateManyInput[] = [];
    let total = new Decimal(0);
    const now = new Date();
    const optOut = campaign.smsType === "PROMOTIONAL" && policy.appendOptOutText ? `\n${policy.promotionalOptOutText}` : "";

    for (const m of members) {
      if (m.status !== "INCLUDED") {
        recipientRows.push({ campaignId, contactId: m.contactId, phone: m.phone, status: m.status });
        continue;
      }
      const body = renderTemplate(campaign.message, m.variables) + optOut;
      const seg = calculateSegments(body, policy.segmentation);
      if (seg.exceedsMax || !body.trim()) {
        recipientRows.push({ campaignId, contactId: m.contactId, phone: m.phone, status: "SKIPPED_INVALID" });
        continue;
      }
      const cost = messageCost(seg.segments, 1, rate);
      const messageId = randomUUID();
      messageRows.push({
        id: messageId,
        organizationId: org.id,
        campaignId,
        source: "CAMPAIGN",
        to: m.phone,
        operator: detectOperator(m.phone),
        senderValue: campaign.senderValue,
        senderType: campaign.senderType,
        smsType: campaign.smsType,
        body,
        encoding: seg.encoding,
        segments: seg.segments,
        unitPrice: rate.toString(),
        cost: cost.toString(),
        nextAttemptAt: now,
        queuedAt: now,
      });
      recipientRows.push({ campaignId, contactId: m.contactId, phone: m.phone, status: "INCLUDED", messageId, variables: m.variables });
      total = total.plus(cost);
    }

    if (!messageRows.length) throw new AppError("VALIDATION_ERROR", "No eligible recipients (all were invalid, blocked or opted out).");

    await db.$transaction(
      async (tx) => {
        await lockWallet(tx, org.id);
        await assertWithinSendingLimits(tx, org.id, messageRows.length);
        await debitWallet(tx, {
          organizationId: org.id,
          amount: total,
          reason: "SMS_CHARGE",
          description: `Campaign "${campaign.name}" (${messageRows.length} recipients)`,
          referenceType: "campaign",
          referenceId: campaignId,
          createdById: campaign.createdById,
        });
        for (let i = 0; i < messageRows.length; i += 5000) await tx.message.createMany({ data: messageRows.slice(i, i + 5000) });
        for (let i = 0; i < recipientRows.length; i += 5000) await tx.campaignRecipient.createMany({ data: recipientRows.slice(i, i + 5000), skipDuplicates: true });
        await tx.campaign.update({
          where: { id: campaignId },
          data: {
            recipientCount: recipientRows.length,
            skippedCount: recipientRows.length - messageRows.length,
            queuedCount: messageRows.length,
            actualCost: total.toString(),
          },
        });
      },
      { timeout: 120_000 },
    );
    await audit({
      action: "campaign.launch",
      actor: { type: "SYSTEM" },
      organizationId: org.id,
      targetType: "campaign",
      targetId: campaignId,
      metadata: { recipients: messageRows.length, skipped: recipientRows.length - messageRows.length, cost: total.toFixed(2) },
    });
    await checkLowBalance(org.id);
    return { launched: true as const, messages: messageRows.length };
  } catch (err) {
    const reason = isAppError(err) ? err.message : "Unexpected error while launching the campaign.";
    if (!isAppError(err)) logger.error({ err, campaignId }, "campaign launch failed");
    await db.campaign.update({ where: { id: campaignId }, data: { status: "FAILED", failureReason: reason, completedAt: new Date() } });
    await notify({
      organizationId: campaign.organizationId,
      type: "campaign.failed",
      title: `Campaign "${campaign.name}" could not start`,
      body: reason,
      link: `/dashboard/campaigns/${campaignId}`,
    });
    return { launched: false as const, error: reason };
  }
}

export async function launchDueCampaigns(limit = 5) {
  const due = await db.campaign.findMany({
    where: { status: "SCHEDULED", deletedAt: null, OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }] },
    select: { id: true },
    orderBy: { scheduledAt: "asc" },
    take: limit,
  });
  const results = [];
  for (const c of due) results.push(await launchCampaign(c.id));
  return { due: due.length, launched: results.filter((r) => r.launched).length };
}

/** Marks PROCESSING campaigns COMPLETED once nothing is left in the queue. */
export async function finalizeCampaigns() {
  const processing = await db.campaign.findMany({ where: { status: "PROCESSING" }, select: { id: true } });
  let completed = 0;
  for (const { id } of processing) {
    const queued = await db.message.count({ where: { campaignId: id, status: "QUEUED" } });
    if (queued > 0) continue;
    const done = await db.campaign.updateMany({ where: { id, status: "PROCESSING" }, data: { status: "COMPLETED", completedAt: new Date() } });
    if (!done.count) continue;
    completed++;
    const c = await db.campaign.findUniqueOrThrow({ where: { id } });
    await enqueueWebhookEvent(c.organizationId, "campaign.completed", {
      campaign_id: c.id,
      name: c.name,
      recipients: c.recipientCount,
      submitted: c.submittedCount,
      delivered: c.deliveredCount,
      failed: c.failedCount,
      cost: c.actualCost.toString(),
    });
    const cost = formatBDT(c.actualCost.toString());
    await notify({
      organizationId: c.organizationId,
      type: "campaign.completed",
      title: `Campaign "${c.name}" completed`,
      body: `${c.submittedCount} sent, ${c.deliveredCount} delivered so far, ${c.failedCount} failed.`,
      link: `/dashboard/campaigns/${c.id}`,
      email: (to) =>
        emailTemplates.campaignCompleted(to, { name: c.name, recipients: c.recipientCount, delivered: c.deliveredCount, failed: c.failedCount, cost, campaignId: c.id }),
    });
  }
  return { completed };
}
