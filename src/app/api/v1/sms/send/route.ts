import { runAfter } from "@/lib/run-after";
import { apiHandler } from "@/lib/api/handler";
import { proxyRoute } from "@/lib/laravel/route";
import { RateLimits } from "@/lib/rate-limit";
import { sendMessages } from "@/services/messaging/send";
import { dispatchNow } from "@/services/messaging/dispatcher";
import { sendSmsBody } from "@/features/public-api/schemas";

/** POST /api/v1/sms/send: send one SMS. */
const prismaPOST = apiHandler(
  { auth: "apiKey", scopes: ["sms:send"], body: sendSmsBody, idempotent: true, rateLimit: RateLimits.apiSendPerKey },
  async ({ body, ctx }) => {
    const result = await sendMessages(ctx!, {
      recipients: [{ phone: body.to }],
      message: body.message,
      senderId: body.sender_id,
      smsType: body.type,
      source: "API",
      clientReference: body.reference,
      scheduledAt: body.schedule_at,
      mode: "single",
    });
    const m = result.accepted[0];
    if (!body.schedule_at) runAfter(() => dispatchNow([m.id]));
    return {
      status: 202,
      data: {
        message_id: m.id,
        to: m.to,
        status: "queued",
        segments: m.segments,
        encoding: m.encoding,
        cost: m.cost,
        currency: "BDT",
        scheduled_for: result.scheduledAt,
      },
    };
  },
);

/** LARAVEL_FEATURES `publicApi`: the same request (API key, body, Idempotency-Key) is answered by Laravel. */
export const POST = proxyRoute("publicApi", () => "sms/send", prismaPOST);
