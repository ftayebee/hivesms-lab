import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { decryptSecret, hmacSha256 } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { assertPublicDestination } from "@/lib/safe-url";

/**
 * Customer-facing webhooks (delivery reports, campaign events).
 *
 * Each request carries:
 *   X-SMSFlow-Event:      event name
 *   X-SMSFlow-Delivery:   unique delivery id (use it to deduplicate)
 *   X-SMSFlow-Signature:  t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * Failed deliveries retry with exponential backoff (up to 8 attempts over about a day).
 */
export const WEBHOOK_EVENTS = {
  "message.delivered": "A message was delivered to the handset",
  "message.failed": "A message failed permanently (failed, rejected, expired or cancelled)",
  "campaign.completed": "A campaign finished sending",
} as const;

export type WebhookEvent = keyof typeof WEBHOOK_EVENTS;

const MAX_ATTEMPTS = 8;

export async function enqueueWebhookEvent(organizationId: string, event: WebhookEvent, data: Record<string, unknown>, tx?: Tx) {
  const client = tx ?? db;
  const endpoints = await client.webhookEndpoint.findMany({
    where: { organizationId, active: true, events: { has: event } },
    select: { id: true },
  });
  if (!endpoints.length) return;
  const payload = { event, created_at: new Date().toISOString(), data } as Prisma.InputJsonValue;
  await client.webhookDelivery.createMany({ data: endpoints.map((e) => ({ endpointId: e.id, event, payload })) });
}

export function signWebhookPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

export async function deliverPendingWebhooks(limit = 50) {
  const due = await db.webhookDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    include: { endpoint: true },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  let delivered = 0;
  for (const d of due) {
    // Claim to avoid double delivery by parallel workers.
    const claimed = await db.webhookDelivery.updateMany({
      where: { id: d.id, status: "PENDING", attempts: d.attempts },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) },
    });
    if (!claimed.count) continue;
    if (!d.endpoint.active) {
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "FAILED", responseBody: "Endpoint disabled" } });
      continue;
    }
    const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
    let status = 0;
    let responseBody = "";
    try {
      await assertPublicDestination(d.endpoint.url); // SSRF guard (DNS can change after creation)
      const secret = decryptSecret(d.endpoint.secretEncrypted);
      const res = await fetch(d.endpoint.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "SMSFlow-Webhooks/1.0",
          "x-smsflow-event": d.event,
          "x-smsflow-delivery": d.id,
          "x-smsflow-signature": signWebhookPayload(secret, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      responseBody = (await res.text().catch(() => "")).slice(0, 1000);
    } catch (err) {
      responseBody = (err as Error).message.slice(0, 500);
    }
    const ok = status >= 200 && status < 300;
    const attempts = d.attempts + 1;
    await db.webhookDelivery.update({
      where: { id: d.id },
      data: {
        status: ok ? "SUCCEEDED" : attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
        responseStatus: status || null,
        responseBody,
        nextAttemptAt: ok || attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + Math.min(2 ** attempts * 30_000, 6 * 3600_000)),
      },
    });
    await db.webhookEndpoint.update({
      where: { id: d.endpointId },
      data: { lastDeliveryAt: new Date(), lastStatusCode: status || null, failureCount: ok ? 0 : { increment: 1 } },
    });
    if (ok) delivered++;
    else logger.warn({ endpoint: d.endpointId, status, attempts }, "webhook delivery failed");
  }
  return { processed: due.length, delivered };
}
