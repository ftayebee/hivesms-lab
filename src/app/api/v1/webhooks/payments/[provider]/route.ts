import type { NextRequest } from "next/server";
import { proxyRoute } from "@/lib/laravel/route";
import { logger } from "@/lib/logger";
import { rateLimit, RateLimits } from "@/lib/rate-limit";
import { clientIp } from "@/lib/api/handler";
import { processPaymentCallback } from "@/services/payments/callbacks";

/** Server-to-server payment notification (IPN). Always re-validated with the gateway by the adapter. */
async function prismaPOST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const rl = await rateLimit(`webhook-pay:${clientIp(req)}`, RateLimits.webhookPerIp);
  if (!rl.allowed) return new Response("rate limited", { status: 429 });
  const raw = await req.text();
  try {
    const r = await processPaymentCallback(provider, { query: req.nextUrl.searchParams, form: new URLSearchParams(raw), headers: req.headers });
    return Response.json({ received: true, outcome: r.outcome });
  } catch (err) {
    logger.error({ err, provider }, "payment IPN failed");
    return Response.json({ received: false }, { status: 500 });
  }
}

/** LARAVEL_FEATURES `webhooks`: verified and applied by Laravel (signature over the unchanged raw body). */
export const POST = proxyRoute("webhooks", (p) => `webhooks/payments/${encodeURIComponent(p.provider)}`, prismaPOST);
