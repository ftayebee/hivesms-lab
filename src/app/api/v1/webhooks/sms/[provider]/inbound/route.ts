import type { NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { rateLimit, RateLimits } from "@/lib/rate-limit";
import { clientIp } from "@/lib/api/handler";
import { getSmsProvider } from "@/services/sms";
import { processInboundMessages } from "@/services/messaging/inbound";

/** POST /api/v1/webhooks/sms/{provider}/inbound: inbound SMS (opt-out keywords such as STOP). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider: key } = await ctx.params;
  const rl = await rateLimit(`webhook-sms-in:${clientIp(req)}`, RateLimits.webhookPerIp);
  if (!rl.allowed) return new Response("rate limited", { status: 429 });
  let provider;
  try {
    provider = await getSmsProvider(key);
  } catch {
    return Response.json({ error: "unknown provider" }, { status: 404 });
  }
  if (!provider.parseInboundWebhook) return Response.json({ error: "inbound messages not supported by this provider" }, { status: 404 });
  const rawBody = await req.text();
  if (rawBody.length > 1_000_000) return Response.json({ error: "payload too large" }, { status: 413 });
  const wr = { headers: req.headers, rawBody, query: req.nextUrl.searchParams };
  if (!(await provider.verifyWebhook(wr))) return Response.json({ error: "invalid signature" }, { status: 401 });
  try {
    const result = await processInboundMessages(key, await provider.parseInboundWebhook(wr));
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err, provider: key }, "inbound webhook processing failed");
    return Response.json({ ok: false }, { status: 500 });
  }
}
