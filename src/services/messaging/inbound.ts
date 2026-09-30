import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger, maskPhone } from "@/lib/logger";
import { normalizeBdPhone } from "@/lib/phone";
import { getSmsPolicy } from "@/services/settings";
import type { InboundSms, ParsedDeliveryEvent } from "@/services/sms";
import { applyStatusUpdate, findMessageByProviderId } from "./delivery";

/**
 * Applies provider delivery reports. Each event is stored once (inbound_webhook_events.eventKey
 * is unique) and applied through the forward-only status machine, so replays are harmless.
 */
export async function processDeliveryEvents(provider: string, events: ParsedDeliveryEvent[], signatureValid: boolean) {
  let applied = 0;
  for (const e of events) {
    try {
      await db.inboundWebhookEvent.create({
        data: { provider, kind: "sms.delivery", eventKey: e.eventKey, signatureValid, payload: e.raw as Prisma.InputJsonValue, status: "RECEIVED" },
      });
    } catch {
      continue; // duplicate delivery of the same event
    }
    const msg = await findMessageByProviderId(provider, e.providerMessageId);
    if (!msg || e.status === "UNKNOWN") {
      await db.inboundWebhookEvent.update({ where: { eventKey: e.eventKey }, data: { status: "IGNORED", processedAt: new Date(), error: msg ? "unknown status" : "unknown message" } });
      continue;
    }
    try {
      const outcome = await applyStatusUpdate({
        messageId: msg.id,
        status: e.status,
        source: "PROVIDER_WEBHOOK",
        dedupeKey: `wh:${e.eventKey}`,
        occurredAt: e.occurredAt,
        providerStatus: e.providerStatus,
        errorCode: e.errorCode,
        description: e.description,
        payload: e.raw,
      });
      if (outcome === "applied") applied++;
      await db.inboundWebhookEvent.update({ where: { eventKey: e.eventKey }, data: { status: "PROCESSED", processedAt: new Date() } });
    } catch (err) {
      logger.error({ err, provider, eventKey: e.eventKey }, "failed to apply delivery event");
      await db.inboundWebhookEvent.update({ where: { eventKey: e.eventKey }, data: { status: "FAILED", error: (err as Error).message.slice(0, 500) } });
    }
  }
  return { received: events.length, applied };
}

/**
 * Inbound SMS: opt-out keywords add the sender to the suppression list of every organization
 * that has messaged that number (the inbound number is shared, so we cannot tell which sender
 * the reply was for; suppressing for all of them is the safe choice).
 */
export async function processInboundMessages(provider: string, messages: InboundSms[]) {
  const policy = await getSmsPolicy();
  const keywords = policy.optOutKeywords.map((k) => k.trim().toUpperCase());
  let optOuts = 0;
  for (const m of messages) {
    try {
      await db.inboundWebhookEvent.create({ data: { provider, kind: "sms.inbound", eventKey: m.eventKey, payload: { from: m.from, to: m.to, text: m.text.slice(0, 500) }, status: "RECEIVED" } });
    } catch {
      continue;
    }
    const phone = normalizeBdPhone(m.from);
    const first = m.text.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
    if (!phone || !keywords.includes(first)) {
      await db.inboundWebhookEvent.update({ where: { eventKey: m.eventKey }, data: { status: "IGNORED", processedAt: new Date() } });
      continue;
    }
    const orgs = await db.message.findMany({ where: { to: phone }, distinct: ["organizationId"], select: { organizationId: true }, take: 100 });
    for (const { organizationId } of orgs) {
      await db.suppressionEntry.upsert({
        where: { organizationId_phone: { organizationId, phone } },
        create: { organizationId, phone, reason: "OPT_OUT", source: `${first} reply` },
        update: {},
      });
      await db.contact.updateMany({ where: { organizationId, phone }, data: { consentStatus: "OPTED_OUT", consentAt: new Date(), consentSource: `${first} reply` } });
    }
    optOuts++;
    logger.info({ from: maskPhone(phone), orgs: orgs.length }, "opt-out received");
    await db.inboundWebhookEvent.update({ where: { eventKey: m.eventKey }, data: { status: "PROCESSED", processedAt: new Date() } });
  }
  return { received: messages.length, optOuts };
}
