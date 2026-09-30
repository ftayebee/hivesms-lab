import { db } from "@/lib/db";
import { trackWrite } from "@/lib/background-writes";
import { hmacSha256, randomAlphanumeric, randomToken } from "@/lib/crypto";
import type { TenantContext } from "@/lib/auth/context";
import { jsonStringArray } from "@/lib/utils";

/**
 * API key format: sfk_live_<8-char prefix id>_<43-char secret>
 * Only HMAC-SHA256(API_KEY_PEPPER, fullKey) is stored. API keys are high-entropy random values,
 * so a keyed fast hash is appropriate (unlike passwords); the pepper means a leaked database
 * alone cannot be used to test candidate keys.
 */
export const API_KEY_PREFIX = "sfk_live_";

function pepper() {
  const p = process.env.API_KEY_PEPPER;
  if (!p) throw new Error("API_KEY_PEPPER is not set");
  return p;
}

export function hashApiKey(fullKey: string) {
  return hmacSha256(pepper(), fullKey);
}

export function generateApiKey() {
  const id = randomAlphanumeric(8);
  const prefix = `${API_KEY_PREFIX}${id}`;
  const fullKey = `${prefix}_${randomToken(32)}`;
  return { prefix, fullKey, keyHash: hashApiKey(fullKey) };
}

export interface ApiKeyAuthResult {
  ctx: TenantContext;
  apiKeyId: string;
  scopes: string[];
}

export type ApiKeyAuthError = "missing" | "invalid" | "revoked" | "expired" | "ip_not_allowed" | "org_suspended";

export async function authenticateApiKey(authorization: string | null, ip: string | null): Promise<ApiKeyAuthResult | ApiKeyAuthError> {
  if (!authorization) return "missing";
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const token = m?.[1];
  if (!token || !token.startsWith(API_KEY_PREFIX) || token.length > 120) return "invalid";

  const key = await db.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: { organization: { select: { id: true, status: true, deletedAt: true } } },
  });
  if (!key) return "invalid";
  if (key.status === "REVOKED") return "revoked";
  if (key.expiresAt && key.expiresAt < new Date()) return "expired";
  const ipAllowlist = jsonStringArray(key.ipAllowlist);
  if (ipAllowlist.length && (!ip || !ipAllowlist.includes(ip))) return "ip_not_allowed";
  if (key.organization.deletedAt || key.organization.status !== "ACTIVE") return "org_suspended";

  const scopes = jsonStringArray(key.scopes);

  // Throttled last-used tracking (at most once a minute per key).
  if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
    trackWrite(db.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } }), "api key last used");
  }

  return {
    apiKeyId: key.id,
    scopes,
    ctx: {
      organizationId: key.organizationId,
      organizationStatus: key.organization.status,
      userId: null,
      apiKeyId: key.id,
      roleKey: null,
      // API keys act only through scopes; sending also requires the matching org permission.
      permissions: scopes.includes("sms:send") ? ["sms:send"] : [],
      ip,
    },
  };
}
