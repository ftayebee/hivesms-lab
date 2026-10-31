import { runAfter } from "@/lib/run-after";
import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { RateLimits } from "@/lib/rate-limit";
import { sendMessages } from "@/services/messaging/send";
import { dispatchNow } from "@/services/messaging/dispatcher";
import { bulkSmsBody } from "@/features/public-api/schemas";

/** POST /api/v1/sms/bulk: up to 1,000 recipients, optional per-recipient message/variables. */
const prismaPOST = apiHandler(
  { auth: "apiKey", scopes: ["sms:send"], body: bulkSmsBody, idempotent: true, rateLimit: RateLimits.apiSendPerKey, maxBodyBytes: 3_000_000 },
  async ({ body, ctx }) => {
    const result = await sendMessages(ctx!, {
      recipients: body.recipients.map((r) => (typeof r === "string" ? { phone: r } : { phone: r.to, message: r.message, variables: r.variables })),
      message: body.message,
      senderId: body.sender_id,
      smsType: body.type,
      source: "API",
      clientReference: body.reference,
      scheduledAt: body.schedule_at,
      mode: "bulk",
    });
    if (!body.schedule_at && result.accepted.length <= 200) runAfter(() => dispatchNow(result.accepted.map((a) => a.id)));
    return {
      status: 202,
      data: {
        batch_id: result.batchId,
        accepted: result.accepted.length,
        rejected: result.rejected.length,
        total_segments: result.totalSegments,
        total_cost: result.totalCost,
        currency: "BDT",
        scheduled_for: result.scheduledAt,
        messages: result.accepted.map((m) => ({ message_id: m.id, to: m.to, status: "queued", segments: m.segments, cost: m.cost })),
        errors: result.rejected.map((r) => ({ to: r.to, code: r.code, message: r.reason })),
      },
    };
  },
);

/** LARAVEL_FEATURES `publicApi`: the same request (API key, body, Idempotency-Key) is answered by Laravel. */
export const POST = proxyRoute("publicApi", () => "sms/bulk", prismaPOST);
