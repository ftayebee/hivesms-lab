import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { defaultSmsPolicy, type SmsPolicy } from "@/config/sms";
import { defaultBillingPolicy, type BillingPolicy } from "@/config/pricing";
import { siteConfig } from "@/config/site";
import { unstable_rethrow } from "next/navigation";
import { laravelData } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";

/**
 * Runtime settings stored in the `settings` table, layered over code defaults and env vars.
 * Values are cached per process for a short time; a write clears the local cache and other
 * instances pick up the change within CACHE_TTL_MS.
 *
 * Secret settings are encrypted at rest (AES-256-GCM) and can only be read on the server via
 * getSecretSetting(). listSettingsForAdmin() never returns secret values, only whether set.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; at: number }>();

export const SECRET_KEYS = [
  "sms.provider.apiKey",
  "sms.provider.apiSecret",
  "sms.provider.webhookSecret",
  "payments.sslcommerz.storePassword",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export interface SmsProviderSettings {
  provider: "mock" | "automas" | "http";
  url: string;
  /** Parameter-name mapping for the generic HTTP adapter. */
  mapping?: Partial<Record<"to" | "message" | "senderId" | "apiKey" | "apiSecret" | "type", string>>;
}

export interface PaymentSettings {
  enabled: string[];
  manualInstructions: string;
  sslcommerz: { storeId: string; live: boolean };
}

export interface SiteContentSettings {
  contact: Partial<(typeof siteConfig)["contact"]>;
  announcement: { enabled: boolean; text: string; href?: string };
}

/** Settings the Laravel API publishes at GET /public/policies (non-secret, customer-facing). */
const LARAVEL_POLICY_KEYS = new Set(["sms.policy", "billing.policy"]);

/**
 * With the dashboard on Laravel (LARAVEL_FEATURES `auth`), this app's own database is not used and
 * may be unreachable: policies come from Laravel, the single source of truth. Never from Prisma —
 * a dead database here cost every request a 10 s pool timeout (slow Templates page).
 */
async function readFromLaravel<T>(key: string): Promise<T | undefined> {
  if (!LARAVEL_POLICY_KEYS.has(key)) return undefined; // nothing else is read on this path
  const hit = cache.get("laravel:policies");
  let all = hit && Date.now() - hit.at < CACHE_TTL_MS ? (hit.value as Record<string, unknown> | undefined) : undefined;
  if (!hit || Date.now() - hit.at >= CACHE_TTL_MS) {
    try {
      all = await laravelData<Record<string, unknown>>("public/policies", undefined, { auth: false, timeoutMs: 5_000 });
    } catch (err) {
      unstable_rethrow(err);
      logger.warn({ err: (err as Error).message }, "policies unavailable from the API, using defaults");
      all = undefined;
    }
    cache.set("laravel:policies", { value: all, at: Date.now() }); // failures are cached too
  }
  return all?.[key] as T | undefined;
}

async function readRaw<T>(key: string): Promise<T | undefined> {
  if (laravelEnabled("auth")) return readFromLaravel<T>(key);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T | undefined;
  try {
    const row = await db.setting.findUnique({ where: { key } });
    const value = row && !row.isSecret ? (row.value as T) : undefined;
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch (err) {
    // The database may be unreachable (static build, outage): fall back to defaults, and remember
    // the failure for CACHE_TTL_MS so every request does not wait for the pool timeout again.
    logger.warn({ err: (err as Error).message, key }, "settings read failed, using defaults");
    cache.set(key, { value: undefined, at: Date.now() });
    return undefined;
  }
}

export async function setSetting(key: string, value: unknown, updatedById?: string) {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue, updatedById },
    update: { value: value as Prisma.InputJsonValue, updatedById },
  });
  cache.delete(key);
}

export async function setSecretSetting(key: SecretKey, plaintext: string | null, updatedById?: string) {
  if (!plaintext) {
    await db.setting.deleteMany({ where: { key } });
  } else {
    const value = { ciphertext: encryptSecret(plaintext) };
    await db.setting.upsert({
      where: { key },
      create: { key, value, isSecret: true, updatedById },
      update: { value, isSecret: true, updatedById },
    });
  }
  cache.delete(`secret:${key}`);
}

/** Server-only secret access. Falls back to the given env value. */
export async function getSecretSetting(key: SecretKey, envFallback = ""): Promise<string> {
  const cacheKey = `secret:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return (hit.value as string) || envFallback;
  try {
    const row = await db.setting.findUnique({ where: { key } });
    const ct = (row?.value as { ciphertext?: string } | null)?.ciphertext;
    const plain = ct ? decryptSecret(ct) : "";
    cache.set(cacheKey, { value: plain, at: Date.now() });
    return plain || envFallback;
  } catch (err) {
    logger.error({ err: (err as Error).message, key }, "failed to read secret setting");
    return envFallback;
  }
}

export async function getSmsPolicy(): Promise<SmsPolicy> {
  const override = await readRaw<Partial<SmsPolicy>>("sms.policy");
  return {
    ...defaultSmsPolicy,
    ...override,
    segmentation: { ...defaultSmsPolicy.segmentation, ...override?.segmentation },
  };
}

export async function getBillingPolicy(): Promise<BillingPolicy> {
  const override = await readRaw<Partial<BillingPolicy>>("billing.policy");
  return { ...defaultBillingPolicy, ...override };
}

export async function getSmsProviderSettings(): Promise<SmsProviderSettings> {
  const override = await readRaw<Partial<SmsProviderSettings>>("sms.provider");
  return {
    provider: override?.provider ?? ((process.env.SMS_PROVIDER as SmsProviderSettings["provider"]) || "mock"),
    url: override?.url ?? process.env.SMS_PROVIDER_URL ?? "",
    mapping: override?.mapping,
  };
}

export async function getPaymentSettings(): Promise<PaymentSettings> {
  const override = await readRaw<Partial<PaymentSettings>>("payments");
  const envEnabled = (process.env.PAYMENT_PROVIDERS ?? "mock,manual")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    enabled: override?.enabled ?? envEnabled,
    manualInstructions:
      override?.manualInstructions ??
      "Transfer the total amount to the account shown on your invoice, then submit the transaction reference below. Credits are added after our team verifies the payment.",
    sslcommerz: {
      storeId: override?.sslcommerz?.storeId ?? process.env.PAYMENT_PROVIDER_KEY ?? "",
      live: override?.sslcommerz?.live ?? process.env.PAYMENT_PROVIDER_LIVE === "true",
    },
  };
}

/** Site content from Laravel's public endpoint (LARAVEL_FEATURES `public`), cached like readRaw. */
async function siteContentFromLaravel(): Promise<Partial<SiteContentSettings> | undefined> {
  const hit = cache.get("laravel:site.content");
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as Partial<SiteContentSettings> | undefined;
  try {
    const value = await laravelData<Partial<SiteContentSettings>>("public/site-content", undefined, { auth: false });
    cache.set("laravel:site.content", { value, at: Date.now() });
    return value;
  } catch (err) {
    unstable_rethrow(err);
    // Public pages still render with the built-in contact details.
    logger.warn({ err: (err as Error).message }, "site content unavailable from the API, using defaults");
    cache.set("laravel:site.content", { value: undefined, at: Date.now() }); // don't retry on every request
    return undefined;
  }
}

export async function getSiteContent(): Promise<SiteContentSettings & { contactResolved: (typeof siteConfig)["contact"] }> {
  const override = laravelEnabled("public") ? await siteContentFromLaravel() : await readRaw<Partial<SiteContentSettings>>("site.content");
  const contact = override?.contact ?? {};
  return {
    contact,
    announcement: override?.announcement ?? { enabled: false, text: "" },
    contactResolved: { ...siteConfig.contact, ...stripEmpty(contact) },
  };
}

function stripEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== "" && v != null)) as Partial<T>;
}

export async function listSecretStatus(): Promise<Record<SecretKey, boolean>> {
  const rows = await db.setting.findMany({ where: { key: { in: [...SECRET_KEYS] } }, select: { key: true } });
  const set = new Set(rows.map((r) => r.key));
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, set.has(k)])) as Record<SecretKey, boolean>;
}

export function clearSettingsCache() {
  cache.clear();
}
