import type { MessageEventSource, MessageStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db, withTransactionRetry } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getSmsPolicy } from "@/services/settings";
import { creditWallet } from "@/services/billing/wallet";
import { enqueueWebhookEvent } from "./outbound-webhooks";

/**
 * Message status transitions. Status only moves forward:
 *
 *   QUEUED ─► SUBMITTED ─► DELIVERED
 *     │          └──────► FAILED | REJECTED | EXPIRED
 *     └─► FAILED | REJECTED | CANCELLED | DELIVERED
 *
 * Terminal statuses never change, so a late or replayed provider event cannot overwrite a final
 * result. Every applied or received event is stored in message_events with a unique dedupe key,
 * which makes webhook processing idempotent.
 */
const ALLOWED_FROM: Record<MessageStatus, MessageStatus[]> = {
  QUEUED: [],
  SUBMITTED: ["QUEUED"],
  DELIVERED: ["QUEUED", "SUBMITTED"],
  FAILED: ["QUEUED", "SUBMITTED"],
  REJECTED: ["QUEUED", "SUBMITTED"],
  EXPIRED: ["QUEUED", "SUBMITTED"],
  CANCELLED: ["QUEUED"],
};

export const TERMINAL_FAILURES: MessageStatus[] = ["FAILED", "REJECTED", "EXPIRED", "CANCELLED"];

export interface StatusUpdate {
  messageId: string;
  status: MessageStatus;
  source: MessageEventSource;
  dedupeKey: string;
  occurredAt?: Date;
  providerStatus?: string | null;
  errorCode?: string | null;
  description?: string | null;
  provider?: string;
  providerMessageId?: string;
  payload?: unknown;
  /** Override refund behaviour (e.g. no refund when a delivery report never arrived). */
  refund?: boolean;
}

export type TransitionOutcome = "applied" | "duplicate" | "stale" | "not_found";

export async function applyStatusUpdate(update: StatusUpdate): Promise<TransitionOutcome> {
  const policy = await getSmsPolicy();
  const occurredAt = update.occurredAt ?? new Date();

  // Retried as a whole if InnoDB picks it as a deadlock victim (it was rolled back, so this is safe).
  const result = await withTransactionRetry(() => db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; status: MessageStatus }[]>`
      SELECT id, status FROM messages WHERE id = ${update.messageId} FOR UPDATE`;
    if (!locked.length) return { outcome: "not_found" as const };

    const inserted = await tx.messageEvent.createMany({
      data: [
        {
          messageId: update.messageId,
          status: update.status,
          providerStatus: update.providerStatus ?? null,
          description: update.description ?? null,
          source: update.source,
          dedupeKey: update.dedupeKey,
          payload: (update.payload ?? undefined) as Prisma.InputJsonValue | undefined,
          occurredAt,
        },
      ],
      skipDuplicates: true,
    });
    if (!inserted.count) return { outcome: "duplicate" as const };

    const previous = locked[0].status;
    if (!ALLOWED_FROM[update.status].includes(previous)) return { outcome: "stale" as const };

    const data: Prisma.MessageUpdateInput = {
      status: update.status,
      lockedUntil: null,
      nextAttemptAt: null,
      ...(update.provider ? { provider: update.provider } : {}),
      ...(update.providerMessageId ? { providerMessageId: update.providerMessageId } : {}),
      ...(update.errorCode !== undefined ? { errorCode: update.errorCode } : {}),
      ...(update.description && update.status !== "DELIVERED" && update.status !== "SUBMITTED" ? { errorMessage: update.description } : {}),
    };
    if (update.status === "SUBMITTED") data.submittedAt = occurredAt;
    if (update.status === "DELIVERED") {
      data.deliveredAt = occurredAt;
      if (previous === "QUEUED") data.submittedAt = occurredAt;
    }
    const isFailure = TERMINAL_FAILURES.includes(update.status);
    if (isFailure) data.failedAt = occurredAt;

    const msg = await tx.message.update({ where: { id: update.messageId }, data });

    // Refunds: always when the message never left the platform; otherwise per policy.
    const shouldRefund =
      isFailure && update.refund !== false && Number(msg.cost) > 0 && !msg.refundedAt && (previous === "QUEUED" || policy.refundFailedMessages);
    if (shouldRefund) {
      await creditWallet(tx, {
        organizationId: msg.organizationId,
        amount: msg.cost.toString(),
        reason: "REFUND",
        description: `Refund: ${update.status.toLowerCase()} message to ${msg.to}`,
        referenceType: "message",
        referenceId: msg.id,
      });
      await tx.message.update({ where: { id: msg.id }, data: { refundedAt: new Date() } });
    }

    if (msg.campaignId) {
      const inc: Prisma.CampaignUpdateInput = {};
      if (previous === "QUEUED") inc.queuedCount = { decrement: 1 };
      if (update.status === "SUBMITTED" || (update.status === "DELIVERED" && previous === "QUEUED")) inc.submittedCount = { increment: 1 };
      if (update.status === "DELIVERED") inc.deliveredCount = { increment: 1 };
      if (isFailure) inc.failedCount = { increment: 1 };
      if (shouldRefund) {
        inc.refundedAmount = { increment: msg.cost.toString() };
        inc.actualCost = { decrement: msg.cost.toString() };
      }
      await tx.campaign.update({ where: { id: msg.campaignId }, data: inc });
    }

    if (update.status === "DELIVERED" || isFailure) {
      await enqueueWebhookEvent(
        msg.organizationId,
        update.status === "DELIVERED" ? "message.delivered" : "message.failed",
        {
          message_id: msg.id,
          to: msg.to,
          status: update.status.toLowerCase(),
          error_code: msg.errorCode,
          error_message: msg.errorMessage,
          segments: msg.segments,
          cost: msg.cost.toString(),
          refunded: shouldRefund,
          client_reference: msg.clientReference,
          campaign_id: msg.campaignId,
          occurred_at: occurredAt.toISOString(),
        },
        tx,
      );
    }
    return { outcome: "applied" as const };
  }));

  if (result.outcome === "stale") {
    logger.debug({ messageId: update.messageId, status: update.status }, "ignored out-of-order status update");
  }
  return result.outcome;
}

/** Resolves a provider message id to our message id. */
export async function findMessageByProviderId(provider: string, providerMessageId: string) {
  return db.message.findUnique({ where: { provider_providerMessageId: { provider, providerMessageId } }, select: { id: true, organizationId: true } });
}
