import { getPaymentSettings, getSecretSetting } from "@/services/settings";
import { ManualPaymentProvider, MockPaymentProvider, SslCommerzProvider } from "./providers";
import type { PaymentProvider } from "./types";

export * from "./types";

export const PAYMENT_PROVIDER_KEYS = ["mock", "manual", "sslcommerz"] as const;
export type PaymentProviderKey = (typeof PAYMENT_PROVIDER_KEYS)[number];

function mockAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_MOCK_PAYMENTS === "true";
}

export async function getPaymentProvider(key: string): Promise<PaymentProvider | null> {
  const settings = await getPaymentSettings();
  if (!settings.enabled.includes(key)) return null;
  switch (key) {
    case "mock":
      return mockAllowed() ? new MockPaymentProvider() : null;
    case "manual":
      return new ManualPaymentProvider(settings.manualInstructions);
    case "sslcommerz": {
      const password = await getSecretSetting("payments.sslcommerz.storePassword", process.env.PAYMENT_PROVIDER_SECRET ?? "");
      if (!settings.sslcommerz.storeId || !password) return null;
      return new SslCommerzProvider(settings.sslcommerz.storeId, password, settings.sslcommerz.live);
    }
    default:
      return null;
  }
}

/** Providers the customer can choose at checkout (configured and enabled only). */
export async function listAvailablePaymentProviders() {
  const settings = await getPaymentSettings();
  const out: { key: string; name: string; description: string; verified: boolean }[] = [];
  for (const key of settings.enabled) {
    const p = await getPaymentProvider(key);
    if (p) out.push({ key: p.key, name: p.displayName, description: p.description, verified: p.verified });
  }
  return out;
}
