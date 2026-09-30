import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { purgeExpiredRateLimits } from "@/lib/rate-limit";
import { finalizeCampaigns, launchDueCampaigns } from "./campaign-runner";
import { pollDeliveryStatuses, processQueue } from "./dispatcher";
import { deliverPendingWebhooks } from "./outbound-webhooks";
import { applyStatusUpdate } from "./delivery";

/**
 * One unit of background work. Safe to run concurrently from several processes (all steps use
 * atomic claims). Invoked by scripts/worker.ts in a loop, or by POST /api/internal/worker/tick
 * from an external scheduler.
 */
export async function runWorkerTick(opts: { maxBatches?: number; batchSize?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  // Cron-driven ticks run inside an HTTP request: stop claiming new batches once the budget is
  // spent so the request finishes before proxy timeouts. Unsent messages wait for the next tick.
  const deadline = opts.budgetMs ? started + opts.budgetMs : Infinity;
  const campaigns = await launchDueCampaigns();

  let claimed = 0;
  let submitted = 0;
  const maxBatches = opts.maxBatches ?? 10;
  for (let i = 0; i < maxBatches; i++) {
    const r = await processQueue(opts.batchSize ?? 100);
    claimed += r.claimed;
    submitted += r.submitted;
    if (r.claimed === 0 || Date.now() > deadline) break;
  }

  await cancelLeftoverMessages();
  const polled = await pollDeliveryStatuses();
  const finalized = await finalizeCampaigns();
  const webhooks = await deliverPendingWebhooks();

  const summary = {
    campaignsLaunched: campaigns.launched,
    claimed,
    submitted,
    statusUpdates: polled.updated,
    campaignsCompleted: finalized.completed,
    webhooksDelivered: webhooks.delivered,
    ms: Date.now() - started,
  };
  if (claimed || polled.updated || campaigns.launched || finalized.completed || webhooks.processed) {
    logger.info(summary, "worker tick");
  }
  return summary;
}

/** Cancelled campaigns may still have queued messages (large sends); cancel and refund them. */
async function cancelLeftoverMessages() {
  const leftovers = await db.message.findMany({
    where: { status: "QUEUED", campaign: { status: "CANCELLED" } },
    select: { id: true },
    take: 500,
  });
  for (const m of leftovers) {
    await applyStatusUpdate({ messageId: m.id, status: "CANCELLED", source: "SYSTEM", dedupeKey: `cancel:${m.id}`, description: "Campaign cancelled" });
  }
}

let lastHousekeeping = 0;

/** Periodic cleanup of expired rows. Runs at most every 10 minutes per process. */
export async function runHousekeeping(force = false) {
  if (!force && Date.now() - lastHousekeeping < 10 * 60_000) return;
  lastHousekeeping = Date.now();
  const now = new Date();
  // Online payments that were never completed expire after 48 hours (manual transfers awaiting
  // verification are left for an admin).
  await db.payment.updateMany({
    where: { status: "PENDING", provider: { not: "manual" }, createdAt: { lt: new Date(now.getTime() - 48 * 3600_000) } },
    data: { status: "CANCELLED", failureReason: "Expired: payment was not completed within 48 hours" },
  });
  const [sessions, limits, idem, tokens] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    purgeExpiredRateLimits(),
    db.idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.verificationToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } }),
  ]);
  logger.info({ sessions: sessions.count, rateLimits: limits.count, idempotencyKeys: idem.count, tokens: tokens.count }, "housekeeping");
}
