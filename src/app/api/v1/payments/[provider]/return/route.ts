import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import { proxyRoute } from "@/lib/laravel/route";
import { processPaymentCallback } from "@/services/payments/callbacks";

/**
 * Browser return from a hosted payment page (gateways usually POST form data here). The result is
 * verified server-to-server by the provider adapter before any balance is added; the customer is
 * then redirected to the payment status page.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const base = process.env.APP_URL ?? req.nextUrl.origin;
  let form = new URLSearchParams();
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      form = new URLSearchParams([...fd.entries()].filter((e): e is [string, string] => typeof e[1] === "string"));
    }
  }
  try {
    const r = await processPaymentCallback(provider, { query: req.nextUrl.searchParams, form, headers: req.headers });
    if (r.paymentId) return NextResponse.redirect(`${base}/dashboard/wallet/payments/${r.paymentId}${r.outcome === "succeeded" ? "" : "?result=not_completed"}`, 303);
  } catch (err) {
    logger.error({ err, provider }, "payment return handling failed");
  }
  return NextResponse.redirect(`${base}/dashboard/wallet?payment=unknown`, 303);
}

/** LARAVEL_FEATURES `webhooks`: Laravel re-validates with the gateway and redirects to the payment page. */
const viaLaravel = proxyRoute("webhooks", (p) => `payments/${encodeURIComponent(p.provider)}/return`, handle);

export const GET = viaLaravel;
export const POST = viaLaravel;
