import type { Message, MessageEvent } from "@/generated/prisma/client";

/** Stable public JSON shape for messages (snake_case, lower-case enums, money as strings). */
export function serializeMessage(m: Message & { events?: MessageEvent[] }) {
  return {
    message_id: m.id,
    to: m.to,
    status: m.status.toLowerCase(),
    type: m.smsType.toLowerCase(),
    sender_id: m.senderValue,
    segments: m.segments,
    encoding: m.encoding,
    cost: m.cost.toFixed(2),
    currency: "BDT",
    refunded: Boolean(m.refundedAt),
    error_code: m.errorCode,
    error_message: m.errorMessage,
    reference: m.clientReference,
    campaign_id: m.campaignId,
    queued_at: m.queuedAt.toISOString(),
    scheduled_for: m.nextAttemptAt && m.status === "QUEUED" && m.nextAttemptAt > m.queuedAt ? m.nextAttemptAt.toISOString() : null,
    submitted_at: m.submittedAt?.toISOString() ?? null,
    delivered_at: m.deliveredAt?.toISOString() ?? null,
    failed_at: m.failedAt?.toISOString() ?? null,
    ...(m.events
      ? {
          events: m.events
            .filter((e) => e.status !== "QUEUED")
            .map((e) => ({ status: e.status.toLowerCase(), at: e.occurredAt.toISOString(), description: e.description })),
        }
      : {}),
  };
}
