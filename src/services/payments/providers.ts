import { logger } from "@/lib/logger";
import type { CallbackRequest, CallbackResult, CheckoutRequest, CheckoutResult, PaymentProvider } from "./types";

/**
 * Development-only simulated checkout. Redirects to an in-app page that clearly says it is a
 * simulation and lets the developer choose success or failure. Disabled in production unless
 * ALLOW_MOCK_PAYMENTS=true (for staging).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly key = "mock";
  readonly displayName = "Test payment (simulation)";
  readonly description = "Simulated checkout for development. No money is charged.";
  readonly verified = true;
  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    return { type: "redirect", url: `/dashboard/wallet/mock-checkout/${req.paymentId}` };
  }
}

/**
 * Manual payment (bank transfer or any off-platform method). The customer pays outside the
 * platform and submits a reference; an admin verifies it in Admin → Payments, which credits the
 * wallet. Real and usable without any third-party integration.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly key = "manual";
  readonly displayName = "Bank transfer / manual payment";
  readonly description = "Pay offline, submit your transaction reference, and we verify it.";
  readonly verified = true;
  constructor(private instructions: string) {}
  async createCheckout(): Promise<CheckoutResult> {
    return { type: "manual", instructions: this.instructions };
  }
}

/**
 * SSLCommerz hosted checkout (Bangladesh payment aggregator).
 *
 * ⚠ UNVERIFIED. Implemented from SSLCommerz's publicly documented v4 session and validation
 * APIs, but NOT tested against a sandbox account in this codebase. Before enabling:
 *   - obtain sandbox credentials and set them in Admin → Settings → Payments;
 *   - run a full sandbox payment, a failure and a cancellation;
 *   - confirm the IPN reaches /api/v1/webhooks/payments/sslcommerz from the internet.
 */
export class SslCommerzProvider implements PaymentProvider {
  readonly key = "sslcommerz";
  readonly displayName = "SSLCommerz (cards, mobile banking)";
  readonly description = "Hosted checkout by SSLCommerz. Requires merchant credentials.";
  readonly verified = false;

  constructor(
    private storeId: string,
    private storePassword: string,
    private live: boolean,
  ) {}

  private get base() {
    return this.live ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com";
  }

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    if (!this.storeId || !this.storePassword) throw new Error("SSLCommerz credentials are not configured.");
    const form = new URLSearchParams({
      store_id: this.storeId,
      store_passwd: this.storePassword,
      total_amount: req.total,
      currency: req.currency,
      tran_id: req.paymentId,
      success_url: req.successUrl,
      fail_url: req.failUrl,
      cancel_url: req.cancelUrl,
      ipn_url: req.callbackUrl,
      cus_name: req.customer.name,
      cus_email: req.customer.email,
      cus_phone: req.customer.phone ?? "N/A",
      cus_add1: "N/A",
      cus_city: "Dhaka",
      cus_country: "Bangladesh",
      shipping_method: "NO",
      product_name: req.description,
      product_category: "SMS credit",
      product_profile: "non-physical-goods",
    });
    const res = await fetch(`${this.base}/gwprocess/v4/api.php`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as { status?: string; GatewayPageURL?: string; sessionkey?: string; failedreason?: string };
    if (body.status !== "SUCCESS" || !body.GatewayPageURL) {
      logger.error({ provider: this.key, status: body.status, reason: body.failedreason }, "sslcommerz session failed");
      throw new Error(body.failedreason ?? "Could not start the payment session.");
    }
    return { type: "redirect", url: body.GatewayPageURL, providerRef: body.sessionkey };
  }

  async handleCallback(req: CallbackRequest): Promise<CallbackResult> {
    const tranId = req.form.get("tran_id") ?? req.query.get("tran_id") ?? "";
    const valId = req.form.get("val_id") ?? "";
    const status = (req.form.get("status") ?? "").toUpperCase();
    if (!tranId) throw new Error("Missing tran_id");
    if (status === "CANCELLED") return { paymentId: tranId, outcome: "cancelled", reason: "Cancelled by customer" };
    if (!valId || (status !== "VALID" && status !== "VALIDATED")) {
      return { paymentId: tranId, outcome: "failed", reason: req.form.get("error") ?? `Gateway status ${status || "unknown"}` };
    }
    // Never trust the browser redirect: confirm with the validation API.
    const url = new URL(`${this.base}/validator/api/validationserverAPI.php`);
    url.search = new URLSearchParams({ val_id: valId, store_id: this.storeId, store_passwd: this.storePassword, v: "1", format: "json" }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const v = (await res.json().catch(() => ({}))) as { status?: string; tran_id?: string; amount?: string; currency?: string; bank_tran_id?: string };
    const ok = (v.status === "VALID" || v.status === "VALIDATED") && v.tran_id === tranId && v.currency === "BDT";
    return {
      paymentId: tranId,
      outcome: ok ? "succeeded" : "failed",
      providerRef: v.bank_tran_id ?? valId,
      confirmedAmount: v.amount,
      reason: ok ? undefined : `Validation returned ${v.status ?? "no status"}`,
      raw: { status: v.status, tran_id: v.tran_id, amount: v.amount },
    };
  }
}
