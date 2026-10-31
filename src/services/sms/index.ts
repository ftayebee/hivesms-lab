import { getSecretSetting, getSmsProviderSettings } from "@/services/settings";
import { AutomasSmsProvider } from "./automas-provider";
import { HttpSmsProvider } from "./http-provider";
import { MockSmsProvider } from "./mock-provider";
import type { SmsProvider } from "./types";

export * from "./types";

/**
 * Resolves the active SMS provider from settings (admin-configurable) with env fallbacks.
 * Add new adapters here after implementing the SmsProvider interface.
 */
export async function getSmsProvider(key?: string): Promise<SmsProvider> {
  const settings = await getSmsProviderSettings();
  const selected = key ?? settings.provider;
  const webhookSecret = await getSecretSetting("sms.provider.webhookSecret", process.env.SMS_PROVIDER_WEBHOOK_SECRET ?? "");

  switch (selected) {
    case "automas":
      return new AutomasSmsProvider({ apiKey: await getSecretSetting("sms.provider.apiKey", process.env.SMS_PROVIDER_API_KEY ?? "") });
    case "http":
      return new HttpSmsProvider({
        url: settings.url,
        apiKey: await getSecretSetting("sms.provider.apiKey", process.env.SMS_PROVIDER_API_KEY ?? ""),
        apiSecret: await getSecretSetting("sms.provider.apiSecret", process.env.SMS_PROVIDER_API_SECRET ?? ""),
        webhookSecret,
        mapping: settings.mapping,
      });
    case "mock":
      return new MockSmsProvider(webhookSecret);
    default:
      throw new Error(`Unknown SMS provider "${selected}"`);
  }
}

export const SMS_PROVIDER_OPTIONS = [
  { key: "mock", label: "Mock (local simulation, no real SMS)" },
  { key: "automas", label: "Automas Technologies" },
  { key: "http", label: "Generic HTTP gateway (requires provider-specific review)" },
] as const;
