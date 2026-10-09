import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { clearSettingsCache, getBillingPolicy, getPaymentSettings, getSiteContent, getSmsPolicy, getSmsProviderSettings, setSecretSetting, setSetting, type SecretKey } from "@/services/settings";
import { adminActor, type AdminContext } from "./guard";
import { laravelEnabled } from "@/lib/laravel/flags";
import * as viaLaravel from "./laravel";

const money = (max = 1_000_000) => z.coerce.number().min(0).max(max);
const checkbox = z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean());

// ─── Pricing plans ───

export const planSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/, "Use lower-case letters, digits and hyphens."),
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).optional().transform((v) => v || null),
  minRechargeAmount: money(10_000_000),
  transactionalNonMasking: money(100),
  transactionalMasking: money(100),
  promotionalNonMasking: money(100),
  promotionalMasking: money(100),
  senderIdFee: money(100_000),
  features: z
    .string()
    .optional()
    .transform((v) => (v ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 12)),
  isCustom: checkbox,
  isPublic: checkbox,
  isDefault: checkbox,
  highlighted: checkbox,
  active: checkbox,
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
  // Why the plan changes (required when editing an existing plan; recorded in the audit log).
  reason: z.string().trim().max(500).optional().transform((v) => v || null),
});

export async function savePlan(admin: AdminContext, input: z.infer<typeof planSchema>, id?: string) {
  if (laravelEnabled("admin")) return viaLaravel.savePlan(input, id);
  const clash = await db.pricingPlan.findFirst({ where: { key: input.key, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw new AppError("CONFLICT", "Another plan uses this key.", { field: "key" });
  const before = id ? await db.pricingPlan.findUnique({ where: { id } }) : null;
  if (id && !before) throw notFound("Plan");
  if (id && (!input.reason || input.reason.length < 5)) throw new AppError("VALIDATION_ERROR", "Say why the plan changes (at least 5 characters).", { field: "reason" });
  const { reason, ...data } = input;
  const plan = await db.$transaction(async (tx) => {
    if (input.isDefault) await tx.pricingPlan.updateMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
    return id ? tx.pricingPlan.update({ where: { id }, data }) : tx.pricingPlan.create({ data });
  });
  await audit({
    action: id ? "pricing.plan.update" : "pricing.plan.create",
    actor: adminActor(admin),
    targetType: "pricing_plan",
    targetId: plan.id,
    ip: admin.ip,
    metadata: { before: before ? JSON.parse(JSON.stringify(before)) : null, after: JSON.parse(JSON.stringify(plan)), reason },
  });
  return plan;
}

// ─── Credit packages ───

export const packageSchema = z.object({
  name: z.string().trim().min(2).max(40),
  amount: money(10_000_000).refine((v) => v > 0, "Amount must be positive."),
  bonusPercent: z.coerce.number().min(0).max(50),
  description: z.string().trim().max(200).optional().transform((v) => v || null),
  active: checkbox,
  sortOrder: z.coerce.number().int().min(0).max(100).default(0),
});

export async function savePackage(admin: AdminContext, input: z.infer<typeof packageSchema>, id?: string) {
  if (laravelEnabled("admin")) return viaLaravel.savePackage(input, id);
  const before = id ? await db.creditPackage.findUnique({ where: { id } }) : null;
  if (id && !before) throw notFound("Package");
  const pkg = id ? await db.creditPackage.update({ where: { id }, data: input }) : await db.creditPackage.create({ data: input });
  await audit({ action: id ? "pricing.package.update" : "pricing.package.create", actor: adminActor(admin), targetType: "credit_package", targetId: pkg.id, ip: admin.ip, metadata: { before: before ? JSON.parse(JSON.stringify(before)) : null, after: JSON.parse(JSON.stringify(pkg)) } });
}

// ─── Policies ───

export const billingPolicySchema = z.object({
  vatRatePercent: z.coerce.number().min(0).max(50),
  minimumTopUp: money(1_000_000),
  maximumTopUp: money(100_000_000),
  balanceValidityMonths: z.coerce.number().int().min(0).max(120),
  invoicePrefix: z.string().trim().regex(/^[A-Z0-9-]{2,10}$/, "2 to 10 upper-case letters, digits or hyphens."),
});

export async function saveBillingPolicy(admin: AdminContext, input: z.infer<typeof billingPolicySchema>) {
  if (input.maximumTopUp < input.minimumTopUp) throw new AppError("VALIDATION_ERROR", "Maximum must be at least the minimum.", { field: "maximumTopUp" });
  if (laravelEnabled("admin")) return viaLaravel.saveBillingPolicy(input);
  const before = await getBillingPolicy();
  const value = { ...input, pricesExcludeVat: true, balanceValidityMonths: input.balanceValidityMonths || null };
  await setSetting("billing.policy", value, admin.userId);
  await audit({ action: "pricing.billing_policy.update", actor: adminActor(admin), targetType: "setting", targetId: "billing.policy", ip: admin.ip, metadata: { before, after: value } });
}

export const smsPolicySchema = z.object({
  gsmSingle: z.coerce.number().int().min(1).max(1000),
  gsmMulti: z.coerce.number().int().min(1).max(1000),
  ucsSingle: z.coerce.number().int().min(1).max(1000),
  ucsMulti: z.coerce.number().int().min(1).max(1000),
  maxSegments: z.coerce.number().int().min(1).max(20),
  refundFailedMessages: checkbox,
  quietHoursEnabled: checkbox,
  quietStart: z.coerce.number().int().min(0).max(23),
  quietEnd: z.coerce.number().int().min(0).max(23),
  appendOptOutText: checkbox,
  promotionalOptOutText: z.string().trim().max(60),
  reviewThresholdRecipients: z.coerce.number().int().min(1).max(10_000_000),
  optOutKeywords: z.string().transform((v) => v.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20)),
});

export async function saveSmsPolicy(admin: AdminContext, input: z.infer<typeof smsPolicySchema>) {
  if (laravelEnabled("admin")) return viaLaravel.saveSmsPolicy(input);
  const before = await getSmsPolicy();
  const value = {
    segmentation: { gsm7: { single: input.gsmSingle, multipart: input.gsmMulti }, ucs2: { single: input.ucsSingle, multipart: input.ucsMulti }, maxSegments: input.maxSegments },
    refundFailedMessages: input.refundFailedMessages,
    promotionalQuietHours: input.quietHoursEnabled ? { start: input.quietStart, end: input.quietEnd } : null,
    appendOptOutText: input.appendOptOutText,
    promotionalOptOutText: input.promotionalOptOutText,
    reviewThresholdRecipients: input.reviewThresholdRecipients,
    optOutKeywords: input.optOutKeywords,
  };
  await setSetting("sms.policy", value, admin.userId);
  await audit({ action: "settings.sms_policy.update", actor: adminActor(admin), targetType: "setting", targetId: "sms.policy", ip: admin.ip, metadata: { before, after: value } });
}

// ─── Providers (credentials encrypted; never returned to the browser) ───

export const smsProviderSchema = z.object({
  provider: z.enum(["mock", "http"]),
  url: z.string().trim().max(500).optional().default(""),
  apiKey: z.string().max(500).optional().default(""),
  apiSecret: z.string().max(500).optional().default(""),
  webhookSecret: z.string().max(500).optional().default(""),
  clearSecrets: checkbox,
  mapTo: z.string().trim().max(40).optional().default(""),
  mapMessage: z.string().trim().max(40).optional().default(""),
  mapSenderId: z.string().trim().max(40).optional().default(""),
  mapApiKey: z.string().trim().max(40).optional().default(""),
});

async function applySecret(key: SecretKey, value: string, clear: boolean, admin: AdminContext) {
  if (clear) await setSecretSetting(key, null, admin.userId);
  else if (value) await setSecretSetting(key, value, admin.userId);
}

export async function saveSmsProvider(admin: AdminContext, input: z.infer<typeof smsProviderSchema>) {
  // Laravel refuses the mock provider in production and validates the URL itself.
  if (laravelEnabled("admin")) return viaLaravel.saveSmsProvider(input);
  if (input.provider === "http" && !/^https:\/\//.test(input.url)) throw new AppError("VALIDATION_ERROR", "Enter the provider's HTTPS endpoint.", { field: "url" });
  if (input.provider === "mock" && process.env.NODE_ENV === "production") throw new AppError("VALIDATION_ERROR", "The mock provider cannot be used in production.", { field: "provider" });
  const before = await getSmsProviderSettings();
  const mapping = Object.fromEntries(
    Object.entries({ to: input.mapTo, message: input.mapMessage, senderId: input.mapSenderId, apiKey: input.mapApiKey }).filter(([, v]) => v),
  );
  await setSetting("sms.provider", { provider: input.provider, url: input.url, mapping }, admin.userId);
  await applySecret("sms.provider.apiKey", input.apiKey, input.clearSecrets, admin);
  await applySecret("sms.provider.apiSecret", input.apiSecret, input.clearSecrets, admin);
  await applySecret("sms.provider.webhookSecret", input.webhookSecret, input.clearSecrets, admin);
  clearSettingsCache();
  await audit({
    action: "settings.sms_provider.update",
    actor: adminActor(admin),
    targetType: "setting",
    targetId: "sms.provider",
    ip: admin.ip,
    // Never log secret values; only whether they changed.
    metadata: { before, after: { provider: input.provider, url: input.url, mapping }, secretsChanged: Boolean(input.apiKey || input.apiSecret || input.webhookSecret || input.clearSecrets) },
  });
}

export const paymentSettingsSchema = z.object({
  enabled: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : v ? [v] : []))
    .pipe(z.array(z.enum(["mock", "manual", "sslcommerz"]))),
  manualInstructions: z.string().trim().min(10, "Explain how to pay offline.").max(2000),
  sslStoreId: z.string().trim().max(100).optional().default(""),
  sslStorePassword: z.string().max(200).optional().default(""),
  sslLive: checkbox,
  clearSslPassword: checkbox,
});

export async function savePaymentSettings(admin: AdminContext, input: z.infer<typeof paymentSettingsSchema>) {
  if (laravelEnabled("admin")) return viaLaravel.savePaymentSettings(input);
  const before = await getPaymentSettings();
  const value = { enabled: input.enabled, manualInstructions: input.manualInstructions, sslcommerz: { storeId: input.sslStoreId, live: input.sslLive } };
  await setSetting("payments", value, admin.userId);
  await applySecret("payments.sslcommerz.storePassword", input.sslStorePassword, input.clearSslPassword, admin);
  clearSettingsCache();
  await audit({ action: "settings.payments.update", actor: adminActor(admin), targetType: "setting", targetId: "payments", ip: admin.ip, metadata: { before, after: value, secretChanged: Boolean(input.sslStorePassword || input.clearSslPassword) } });
}

export const siteContentSchema = z.object({
  email: z.string().trim().max(120).optional().default(""),
  supportEmail: z.string().trim().max(120).optional().default(""),
  salesEmail: z.string().trim().max(120).optional().default(""),
  abuseEmail: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  address: z.string().trim().max(300).optional().default(""),
  hours: z.string().trim().max(120).optional().default(""),
  announcementEnabled: checkbox,
  announcementText: z.string().trim().max(200).optional().default(""),
  announcementHref: z.string().trim().max(300).optional().default(""),
});

export async function saveSiteContent(admin: AdminContext, input: z.infer<typeof siteContentSchema>) {
  if (laravelEnabled("admin")) return viaLaravel.saveSiteContent(input);
  const before = await getSiteContent();
  const value = {
    contact: { email: input.email, supportEmail: input.supportEmail, salesEmail: input.salesEmail, abuseEmail: input.abuseEmail, phone: input.phone, address: input.address, hours: input.hours },
    announcement: { enabled: input.announcementEnabled, text: input.announcementText, href: input.announcementHref || undefined },
  };
  await setSetting("site.content", value, admin.userId);
  await audit({ action: "settings.site_content.update", actor: adminActor(admin), targetType: "setting", targetId: "site.content", ip: admin.ip, metadata: { before: { contact: before.contact, announcement: before.announcement }, after: value } });
}

// ─── Blocklist ───

export const blocklistSchema = z.object({
  type: z.enum(["NUMBER", "KEYWORD", "URL_DOMAIN"]),
  value: z.string().trim().min(2).max(200),
  reason: z.string().trim().max(200).optional().transform((v) => v || null),
});

export async function addBlocklist(admin: AdminContext, input: z.infer<typeof blocklistSchema>) {
  if (laravelEnabled("admin")) return viaLaravel.addBlocklist(input);
  const value = input.type === "URL_DOMAIN" ? input.value.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : input.type === "KEYWORD" ? input.value.toLowerCase() : input.value;
  const e = await db.blocklistEntry.upsert({ where: { type_value: { type: input.type, value } }, create: { type: input.type, value, reason: input.reason, createdById: admin.userId }, update: { reason: input.reason } });
  await audit({ action: "admin.blocklist.add", actor: adminActor(admin), targetType: "blocklist", targetId: e.id, metadata: { type: input.type, value } });
}

export async function removeBlocklist(admin: AdminContext, id: string) {
  if (laravelEnabled("admin")) return viaLaravel.removeBlocklist(id);
  const e = await db.blocklistEntry.delete({ where: { id } });
  await audit({ action: "admin.blocklist.remove", actor: adminActor(admin), targetType: "blocklist", targetId: id, metadata: { type: e.type, value: e.value } });
}

export type JsonValue = Prisma.JsonValue;
