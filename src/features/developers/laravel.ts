import "server-only";
import type { z } from "zod";
import type { ApiKeyStatus, WebhookDeliveryStatus } from "@/generated/prisma/enums";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date, pageMeta } from "@/lib/laravel/convert";
import type { apiKeySchema, webhookSchema } from "./service";

/**
 * API keys, API logs and webhook endpoints through the Laravel API (LARAVEL_FEATURES `developers`).
 * Laravel never returns key hashes or webhook secrets except the new secret once, at creation —
 * the same behaviour as before.
 */

interface LaravelApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  ipAllowlist: string[];
  status: ApiKeyStatus;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const toKey = (k: LaravelApiKey) => ({ ...k, lastUsedAt: date(k.lastUsedAt), expiresAt: date(k.expiresAt), revokedAt: date(k.revokedAt), createdAt: date(k.createdAt) });

export async function listApiKeys() {
  return (await laravelData<LaravelApiKey[]>("app/api-keys")).map(toKey);
}

/** The full key is returned exactly once (only its HMAC is stored by Laravel). */
export async function createApiKey(input: z.infer<typeof apiKeySchema>) {
  const { data } = await laravel.post<{ apiKey: LaravelApiKey; key: string }>("app/api-keys", {
    name: input.name,
    scopes: input.scopes,
    ipAllowlist: input.ipAllowlist,
    expiresInDays: input.expiresInDays || null,
  });
  return { key: toKey(data.apiKey), fullKey: data.key };
}

export async function revokeApiKey(id: string) {
  await laravel.delete(`app/api-keys/${encodeURIComponent(id)}`);
}

interface LaravelApiLog {
  id: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  errorCode: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  apiKey?: { name: string; prefix: string } | null;
}

export async function listApiLogs(opts: { page: number; status?: "2xx" | "4xx" | "5xx"; keyId?: string }) {
  const res = await laravel.get<LaravelApiLog[]>("app/api-logs", { page: opts.page, status: opts.status, keyId: opts.keyId });
  return {
    rows: res.data.map((r) => ({ ...r, createdAt: date(r.createdAt), apiKey: r.apiKey ?? null })),
    total: pageMeta(res.meta, 30).total,
    stats: res.meta.stats as { total: number; ok: number; clientErrors: number; serverErrors: number },
  };
}

interface LaravelWebhook {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  active: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  lastStatusCode: number | null;
  createdAt: string;
  deliveries?: Array<{ id: string; event: string; status: WebhookDeliveryStatus; responseStatus: number | null; attempts: number; createdAt: string }>;
}

export async function listWebhooks() {
  return (await laravelData<LaravelWebhook[]>("app/webhooks")).map((w) => ({
    ...w,
    lastDeliveryAt: date(w.lastDeliveryAt),
    createdAt: date(w.createdAt),
    deliveries: (w.deliveries ?? []).map((d) => ({ ...d, createdAt: date(d.createdAt) })),
  }));
}

/** The signing secret is returned exactly once (Laravel stores it encrypted). */
export async function createWebhook(input: z.infer<typeof webhookSchema>) {
  const { data } = await laravel.post<{ webhook: LaravelWebhook; secret: string }>("app/webhooks", input);
  return { endpoint: { ...data.webhook, createdAt: date(data.webhook.createdAt) }, secret: data.secret };
}

export async function toggleWebhook(id: string, active: boolean) {
  await laravel.put(`app/webhooks/${encodeURIComponent(id)}`, { active });
}

export async function deleteWebhook(id: string) {
  await laravel.delete(`app/webhooks/${encodeURIComponent(id)}`);
}

export async function sendTestWebhook(id: string) {
  await laravel.post(`app/webhooks/${encodeURIComponent(id)}/test`);
}
