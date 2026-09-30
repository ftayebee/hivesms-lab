import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { sha256 } from "@/lib/crypto";
import { completePayment } from "@/services/billing/payments";
import { getPaymentProvider } from "./index";
import type { CallbackRequest } from "./types";

/**
 * Shared handling for payment gateway browser returns and server-to-server IPNs. The provider
 * adapter verifies the result with the gateway; this function applies it idempotently and
 * records the raw event.
 */
export async function processPaymentCallback(providerKey: string, req: CallbackRequest): Promise<{ paymentId: string | null; outcome: string }> {
  const provider = await getPaymentProvider(providerKey);
  if (!provider?.handleCallback) return { paymentId: null, outcome: "unsupported" };
  const result = await provider.handleCallback(req);
  const payment = await db.payment.findUnique({ where: { id: result.paymentId } }).catch(() => null);
  const eventKey = `payment:${providerKey}:${result.paymentId}:${result.outcome}:${sha256(req.form.toString() + req.query.toString()).slice(0, 16)}`;
  await db.inboundWebhookEvent
    .create({
      data: { provider: providerKey, kind: "payment", eventKey, signatureValid: result.outcome === "succeeded" ? true : null, payload: (result.raw ?? { outcome: result.outcome }) as Prisma.InputJsonValue, status: payment ? "PROCESSED" : "IGNORED", processedAt: new Date() },
    })
    .catch(() => {}); // duplicate delivery of the same callback
  if (!payment || payment.provider !== providerKey) {
    logger.warn({ provider: providerKey, paymentId: result.paymentId }, "payment callback for unknown payment");
    return { paymentId: null, outcome: "unknown_payment" };
  }
  if (result.outcome === "succeeded") {
    // Success is only reported after the adapter re-validated it with the gateway.
    await completePayment(payment.id, { providerRef: result.providerRef, confirmedAmount: result.confirmedAmount, actor: { type: "SYSTEM" }, note: `${providerKey} callback` });
  } else {
    // Failure/cancel callbacks cannot be verified with the gateway, so they never change state
    // (otherwise anyone could fail someone else's pending payment). The payment stays PENDING;
    // the customer can retry or cancel it, and stale pending payments expire.
    logger.info({ provider: providerKey, paymentId: payment.id, outcome: result.outcome, reason: result.reason }, "unverified non-success payment callback recorded");
  }
  return { paymentId: payment.id, outcome: result.outcome };
}
