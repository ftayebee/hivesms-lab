import type { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { rateLimit, RateLimits } from "@/lib/rate-limit";
import { clientIp } from "@/lib/api/handler";
import { getSmsProvider } from "@/services/sms";
import { processDeliveryEvents } from "@/services/messaging/inbound";

/**
 * POST /api/v1/webhooks/sms/{provider}: delivery reports from the upstream SMS provider.
 * The adapter verifies authenticity (signature / shared secret) before anything is applied.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: key } = await ctx.params;
  const rl = await rateLimit(`webhook-sms:${clientIp(req)}`, RateLimits.webhookPerIp);
  if (!rl.allowed) return new Response("rate limited", { status: 429 });
  let provider;
  try {
    provider = await getSmsProvider(key);
  } catch {
    return Response.json({ error: "unknown provider" }, { status: 404 });
  }
  const rawBody = await req.text();
  if (rawBody.length > 2_000_000) return Response.json({ error: "payload too large" }, { status: 413 });
  const wr = { headers: req.headers, rawBody, query: req.nextUrl.searchParams };
  if (!(await provider.verifyWebhook(wr))) {
    logger.warn({ provider: key, ip: clientIp(req) }, "rejected delivery webhook with invalid signature");
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  try {
    const events = await provider.parseDeliveryWebhook(wr);
    const result = await processDeliveryEvents(key, events, true);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, provider: key }, "delivery webhook processing failed");
    // 5xx makes well-behaved providers retry; duplicates are ignored on retry.
    return Response.json({ ok: false }, { status: 500 });
  }
}
