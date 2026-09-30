import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Fixed-window rate limiter backed by PostgreSQL (atomic upsert), so limits hold across
 * multiple app instances without extra infrastructure. The interface is intentionally small
 * so a Redis implementation can replace it later.
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix seconds when the current window resets. */
  resetAt: number;
}

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  /** Window length in seconds. */
  windowSec: number;
}

export async function rateLimit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const windowMs = rule.windowSec * 1000;
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  try {
    const rows = await db.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_buckets (key, "windowStart", count, "expiresAt")
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT (key, "windowStart") DO UPDATE SET count = rate_limit_buckets.count + 1
      RETURNING count`;
    const count = Number(rows[0]?.count ?? 1);
    return {
      allowed: count <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - count),
      resetAt: Math.ceil(expiresAt.getTime() / 1000),
    };
  } catch (err) {
    // Fail open on limiter errors so a database hiccup does not take down login entirely,
    // but make it loud. Sending limits and balance checks are enforced separately.
    logger.error({ err, key }, "rate limiter failure");
    return { allowed: true, limit: rule.limit, remaining: rule.limit, resetAt: Math.ceil(expiresAt.getTime() / 1000) };
  }
}

/** Standard rules used across the app. */
export const RateLimits = {
  loginPerIp: { limit: 20, windowSec: 600 },
  loginPerAccount: { limit: 10, windowSec: 600 },
  registerPerIp: { limit: 5, windowSec: 3600 },
  passwordResetPerIp: { limit: 5, windowSec: 3600 },
  otpPerUser: { limit: 5, windowSec: 3600 },
  publicFormPerIp: { limit: 5, windowSec: 600 },
  apiPerKey: { limit: 600, windowSec: 60 },
  apiSendPerKey: { limit: 120, windowSec: 60 },
  apiAuthFailuresPerIp: { limit: 30, windowSec: 300 },
  webhookPerIp: { limit: 1200, windowSec: 60 },
} satisfies Record<string, RateLimitRule>;

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Reset": String(r.resetAt),
    ...(r.allowed ? {} : { "Retry-After": String(Math.max(1, r.resetAt - Math.floor(Date.now() / 1000))) }),
  };
}

export async function purgeExpiredRateLimits() {
  return db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
