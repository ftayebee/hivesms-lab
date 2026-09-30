import { db } from "@/lib/db";
import { logger, maskPhone } from "@/lib/logger";
import { getSmsProvider, type SmsProvider } from "@/services/sms";
import { getSmsPolicy } from "@/services/settings";
import { applyStatusUpdate } from "./delivery";

/**
 * Sends queued messages to the upstream provider.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED` plus a short lease (lockedUntil), so several worker
 * processes can run safely in parallel and a crashed worker's messages become claimable again
 * after the lease expires. Messages of paused or cancelled campaigns are never claimed.
 */
const LEASE_SECONDS = 120;

export async function claimQueuedMessages(limit: number, ids?: string[]): Promise<string[]> {
  const idFilter = ids?.length ? ids : null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE messages SET "lockedUntil" = now() + make_interval(secs => ${LEASE_SECONDS}), attempts = attempts + 1
    WHERE id IN (
      SELECT m.id FROM messages m
      LEFT JOIN campaigns c ON c.id = m."campaignId"
      JOIN organizations o ON o.id = m."organizationId"
      WHERE m.status = 'QUEUED'
        AND m."nextAttemptAt" <= now()
        AND (m."lockedUntil" IS NULL OR m."lockedUntil" < now())
        AND (m."campaignId" IS NULL OR c.status = 'PROCESSING')
        AND o.status = 'ACTIVE'
        AND (${idFilter}::uuid[] IS NULL OR m.id = ANY(${idFilter}::uuid[]))
      ORDER BY m."nextAttemptAt"
      LIMIT ${limit}
      FOR UPDATE OF m SKIP LOCKED
    )
    RETURNING id`;
  return rows.map((r) => r.id);
}

function backoffMs(attempt: number) {
  // 30s, 1m, 2m, 4m ... capped at 30m, with jitter.
  const base = Math.min(30_000 * 2 ** (attempt - 1), 30 * 60_000);
  return base + Math.floor(Math.random() * 5_000);
}

export async function dispatchMessages(ids: string[], provider?: SmsProvider) {
  if (!ids.length) return { submitted: 0, failed: 0, retried: 0 };
  const smsProvider = provider ?? (await getSmsProvider());
  const policy = await getSmsPolicy();
  const messages = await db.message.findMany({ where: { id: { in: ids } } });
  let submitted = 0;
  let failed = 0;
  let retried = 0;

  const results = await smsProvider.sendBulkSms(
    messages.map((m) => ({
      reference: m.id,
      to: m.to,
      message: m.body,
      senderId: m.senderValue,
      senderType: m.senderType,
      smsType: m.smsType,
      encoding: m.encoding,
    })),
  );

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const r = results[i];
    try {
      if (r.ok) {
        await applyStatusUpdate({
          messageId: m.id,
          status: "SUBMITTED",
          source: "PROVIDER_RESPONSE",
          dedupeKey: `submit:${m.id}`,
          provider: smsProvider.key,
          providerMessageId: r.providerMessageId,
          description: "Accepted by provider",
        });
        submitted++;
      } else if (r.retryable && m.attempts < policy.maxAttempts) {
        await db.message.update({
          where: { id: m.id },
          data: { lockedUntil: null, nextAttemptAt: new Date(Date.now() + backoffMs(m.attempts)), errorCode: r.errorCode, errorMessage: r.errorMessage },
        });
        retried++;
        logger.warn({ messageId: m.id, to: maskPhone(m.to), attempt: m.attempts, code: r.errorCode }, "provider send failed, will retry");
      } else {
        await applyStatusUpdate({
          messageId: m.id,
          status: r.retryable ? "FAILED" : "REJECTED",
          source: "PROVIDER_RESPONSE",
          dedupeKey: `submit-fail:${m.id}`,
          provider: smsProvider.key,
          errorCode: r.errorCode,
          description: r.retryable ? `${r.errorMessage} (gave up after ${m.attempts} attempts)` : r.errorMessage,
        });
        failed++;
      }
    } catch (err) {
      logger.error({ err, messageId: m.id }, "error recording dispatch result");
    }
  }
  return { submitted, failed, retried };
}

/** One dispatch cycle: claim a batch and send it. */
export async function processQueue(batchSize = 100) {
  const ids = await claimQueuedMessages(batchSize);
  if (!ids.length) return { claimed: 0, submitted: 0, failed: 0, retried: 0 };
  const r = await dispatchMessages(ids);
  return { claimed: ids.length, ...r };
}

/** Immediate dispatch for small API sends (called after the response via next/server `after`). */
export async function dispatchNow(messageIds: string[]) {
  try {
    const claimed = await claimQueuedMessages(messageIds.length, messageIds);
    if (claimed.length) await dispatchMessages(claimed);
  } catch (err) {
    logger.error({ err }, "inline dispatch failed; the worker will pick the messages up");
  }
}

/**
 * Polls providers for delivery status of submitted messages. This is the fallback for providers
 * without delivery webhooks and is how the mock provider "delivers". Messages without a report
 * after 72 hours are marked EXPIRED (without refund, since the provider accepted them).
 */
export async function pollDeliveryStatuses(limit = 200) {
  const provider = await getSmsProvider();
  const pollAfterMs = provider.key === "mock" ? 3_000 : 5 * 60_000;
  const now = Date.now();
  const candidates = await db.message.findMany({
    where: {
      status: "SUBMITTED",
      provider: provider.key,
      providerMessageId: { not: null },
      updatedAt: { lt: new Date(now - pollAfterMs) },
    },
    select: { id: true, providerMessageId: true, submittedAt: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  let updated = 0;
  for (const m of candidates) {
    const res = await provider.getDeliveryStatus(m.providerMessageId!);
    if (res.status === "UNKNOWN" || res.status === "SUBMITTED") {
      if (m.submittedAt && now - m.submittedAt.getTime() > 72 * 3600_000) {
        await applyStatusUpdate({
          messageId: m.id,
          status: "EXPIRED",
          source: "SYSTEM",
          dedupeKey: `expire:${m.id}`,
          description: "No delivery report received within 72 hours",
          refund: false,
        });
        updated++;
      } else {
        await db.message.update({ where: { id: m.id }, data: { updatedAt: new Date() } });
      }
      continue;
    }
    const outcome = await applyStatusUpdate({
      messageId: m.id,
      status: res.status,
      source: "PROVIDER_POLL",
      dedupeKey: `poll:${m.id}:${res.status}`,
      occurredAt: res.occurredAt,
      providerStatus: res.providerStatus,
      errorCode: res.errorCode,
      description: res.description,
    });
    if (outcome === "applied") updated++;
  }
  return { checked: candidates.length, updated };
}
