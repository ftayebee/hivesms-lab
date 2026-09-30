/**
 * Payment provider contract. The billing flow (select package → method → confirm → pay →
 * credits added) only depends on this interface. Adding bKash, Nagad, a card gateway or another
 * aggregator means implementing it and registering the adapter; see docs/05-integrations.md.
 */
export interface CheckoutRequest {
  paymentId: string;
  /** Total including VAT, BDT with 2 decimals. */
  total: string;
  currency: "BDT";
  description: string;
  customer: { name: string; email: string; phone?: string | null; organization: string };
  successUrl: string;
  failUrl: string;
  cancelUrl: string;
  /** Server-to-server notification URL (IPN). */
  callbackUrl: string;
}

export type CheckoutResult =
  | { type: "redirect"; url: string; providerRef?: string }
  | { type: "manual"; instructions: string };

export interface CallbackRequest {
  query: URLSearchParams;
  form: URLSearchParams;
  headers: Headers;
}

export interface CallbackResult {
  paymentId: string;
  outcome: "succeeded" | "failed" | "cancelled";
  providerRef?: string;
  /** Amount confirmed by the provider; compared with the expected total. */
  confirmedAmount?: string;
  reason?: string;
  raw?: unknown;
}

export interface PaymentProvider {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  /** False until the adapter has been tested end-to-end against the provider's sandbox. */
  readonly verified: boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Verifies a redirect/IPN callback with the provider and reports the outcome. */
  handleCallback?(req: CallbackRequest): Promise<CallbackResult>;
}
