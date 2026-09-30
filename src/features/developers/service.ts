import { z } from "zod";
import { isIP } from "node:net";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, requirePermission, type TenantContext } from "@/lib/auth/context";
import { ALL_API_SCOPES } from "@/lib/auth/permissions";
import { generateApiKey } from "@/lib/api/api-keys";
import { encryptSecret, randomToken } from "@/lib/crypto";
import { assertAcceptableUrl } from "@/lib/safe-url";
import { notify } from "@/services/notify";
import { WEBHOOK_EVENTS } from "@/services/messaging/outbound-webhooks";

// ─── API keys ───

export const apiKeySchema = z.object({
  name: z.string().trim().min(2, "Name the key after the service that uses it.").max(60),
  scopes: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.enum(ALL_API_SCOPES as [string, ...string[]])).min(1, "Select at least one scope.")),
  ipAllowlist: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const ips = (v ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const ip of ips) if (!isIP(ip)) ctx.addIssue({ code: "custom", message: `"${ip}" is not a valid IP address.` });
      if (ips.length > 20) ctx.addIssue({ code: "custom", message: "At most 20 addresses." });
      return [...new Set(ips)];
    }),
  expiresInDays: z.enum(["", "30", "90", "180", "365"]).optional().default(""),
});

export async function listApiKeys(ctx: TenantContext) {
  requirePermission(ctx, "api_keys:read");
  return db.apiKey.findMany({ where: { organizationId: ctx.organizationId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
}

export async function createApiKey(ctx: TenantContext, input: z.infer<typeof apiKeySchema>) {
  requirePermission(ctx, "api_keys:manage");
  const active = await db.apiKey.count({ where: { organizationId: ctx.organizationId, status: "ACTIVE" } });
  if (active >= 25) throw new AppError("VALIDATION_ERROR", "You can have at most 25 active keys. Revoke unused keys first.");
  const { prefix, fullKey, keyHash } = generateApiKey();
  const key = await db.apiKey.create({
    data: {
      organizationId: ctx.organizationId,
      name: input.name,
      prefix,
      keyHash,
      scopes: input.scopes,
      ipAllowlist: input.ipAllowlist,
      expiresAt: input.expiresInDays ? new Date(Date.now() + Number(input.expiresInDays) * 86_400_000) : null,
      createdById: ctx.userId,
    },
  });
  await audit({ action: "api_key.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "api_key", targetId: key.id, ip: ctx.ip, metadata: { name: key.name, prefix, scopes: input.scopes } });
  await notify({ organizationId: ctx.organizationId, type: "api_key.created", title: `API key "${key.name}" created`, body: `Key ${prefix}… was created. If this wasn't expected, revoke it immediately.`, link: "/dashboard/api" });
  // The full key is returned exactly once and never stored.
  return { key, fullKey };
}

export async function revokeApiKey(ctx: TenantContext, id: string) {
  requirePermission(ctx, "api_keys:manage");
  const k = await db.apiKey.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!k) throw notFound("API key");
  if (k.status === "REVOKED") return;
  await db.apiKey.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date(), revokedById: ctx.userId } });
  await audit({ action: "api_key.revoke", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "api_key", targetId: id, ip: ctx.ip, metadata: { prefix: k.prefix } });
  await notify({ organizationId: ctx.organizationId, type: "api_key.created", title: `API key "${k.name}" revoked`, body: `Requests using ${k.prefix}… are now rejected.`, link: "/dashboard/api" });
}

export const API_LOG_PAGE = 30;

export async function listApiLogs(ctx: TenantContext, opts: { page: number; status?: "2xx" | "4xx" | "5xx"; keyId?: string }) {
  requirePermission(ctx, "api_keys:read");
  const where: Prisma.ApiLogWhereInput = {
    organizationId: ctx.organizationId,
    ...(opts.keyId ? { apiKeyId: opts.keyId } : {}),
    ...(opts.status === "2xx" ? { statusCode: { gte: 200, lt: 300 } } : opts.status === "4xx" ? { statusCode: { gte: 400, lt: 500 } } : opts.status === "5xx" ? { statusCode: { gte: 500 } } : {}),
  };
  const since = new Date(Date.now() - 86_400_000);
  const [rows, total, last24] = await Promise.all([
    db.apiLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (opts.page - 1) * API_LOG_PAGE, take: API_LOG_PAGE, include: { apiKey: { select: { name: true, prefix: true } } } }),
    db.apiLog.count({ where }),
    db.apiLog.groupBy({ by: ["statusCode"], where: { organizationId: ctx.organizationId, createdAt: { gte: since } }, _count: true }),
  ]);
  const sum = (f: (s: number) => boolean) => last24.filter((r) => f(r.statusCode)).reduce((a, r) => a + r._count, 0);
  return { rows, total, stats: { total: sum(() => true), ok: sum((s) => s < 400), clientErrors: sum((s) => s >= 400 && s < 500), serverErrors: sum((s) => s >= 500) } };
}

// ─── Webhook endpoints ───

const EVENT_KEYS = Object.keys(WEBHOOK_EVENTS) as [string, ...string[]];

export const webhookSchema = z.object({
  url: z.string().trim().min(1, "Enter the endpoint URL.").max(500),
  description: z.string().trim().max(200).optional().transform((v) => v || null),
  events: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .pipe(z.array(z.enum(EVENT_KEYS)).min(1, "Select at least one event.")),
});

export async function listWebhooks(ctx: TenantContext) {
  requirePermission(ctx, "api_keys:read");
  return db.webhookEndpoint.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, event: true, status: true, responseStatus: true, attempts: true, createdAt: true } } },
  });
}

export async function createWebhook(ctx: TenantContext, input: z.infer<typeof webhookSchema>) {
  requirePermission(ctx, "api_keys:manage");
  assertAcceptableUrl(input.url);
  const count = await db.webhookEndpoint.count({ where: { organizationId: ctx.organizationId } });
  if (count >= 10) throw new AppError("VALIDATION_ERROR", "You can register at most 10 webhook endpoints.");
  const secret = `whsec_${randomToken(24)}`;
  const ep = await db.webhookEndpoint.create({
    data: { organizationId: ctx.organizationId, url: input.url, description: input.description, events: input.events, secretEncrypted: encryptSecret(secret) },
  });
  await audit({ action: "webhook.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "webhook", targetId: ep.id, metadata: { url: input.url, events: input.events } });
  return { endpoint: ep, secret };
}

async function ownWebhook(ctx: TenantContext, id: string) {
  const ep = await db.webhookEndpoint.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!ep) throw notFound("Webhook");
  return ep;
}

export async function toggleWebhook(ctx: TenantContext, id: string, active: boolean) {
  requirePermission(ctx, "api_keys:manage");
  await ownWebhook(ctx, id);
  await db.webhookEndpoint.update({ where: { id }, data: { active, ...(active ? { failureCount: 0 } : {}) } });
  await audit({ action: active ? "webhook.enable" : "webhook.disable", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "webhook", targetId: id });
}

export async function deleteWebhook(ctx: TenantContext, id: string) {
  requirePermission(ctx, "api_keys:manage");
  await ownWebhook(ctx, id);
  await db.webhookEndpoint.delete({ where: { id } });
  await audit({ action: "webhook.delete", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "webhook", targetId: id });
}

/** Queues a sample event so customers can test their endpoint. */
export async function sendTestWebhook(ctx: TenantContext, id: string) {
  requirePermission(ctx, "api_keys:manage");
  const ep = await ownWebhook(ctx, id);
  await db.webhookDelivery.create({
    data: {
      endpointId: ep.id,
      event: "message.delivered",
      payload: {
        event: "message.delivered",
        created_at: new Date().toISOString(),
        test: true,
        data: { message_id: "00000000-0000-0000-0000-000000000000", to: "+8801XXXXXXXXX", status: "delivered", segments: 1, cost: "0.35", refunded: false, client_reference: "test", campaign_id: null, occurred_at: new Date().toISOString() },
      },
    },
  });
}
