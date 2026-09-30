import "server-only";
import type { NextRequest } from "next/server";
import type { z, ZodType } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { trackWrite } from "@/lib/background-writes";
import { AppError } from "@/lib/errors";
import { randomAlphanumeric, sha256 } from "@/lib/crypto";
import { rateLimit, rateLimitHeaders, RateLimits, type RateLimitRule, type RateLimitResult } from "@/lib/rate-limit";
import { hasPermission, platformCan, type ApiScope, type Permission, type PlatformPermission } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/context";
import { getSession, getTenantContext } from "@/lib/auth/session";
import type { ResolvedSession } from "@/lib/auth/session-store";
import { authenticateApiKey } from "./api-keys";
import { errorResponse, fail, ok, type ApiMeta } from "./response";

/**
 * One wrapper for every /api/v1 route handler: request id, authentication (API key, session or
 * platform admin), scope/permission checks, CSRF origin check for cookie auth, rate limiting,
 * Zod validation, idempotency keys, error mapping and API request logging.
 */
type AuthMode = "none" | "apiKey" | "session" | "admin";

interface HandlerOptions<B extends ZodType | undefined, Q extends ZodType | undefined> {
  auth: AuthMode;
  scopes?: ApiScope[];
  permission?: Permission;
  platformPermission?: PlatformPermission;
  rateLimit?: RateLimitRule;
  body?: B;
  query?: Q;
  /** Honour the Idempotency-Key header (POST endpoints that create resources or send). */
  idempotent?: boolean;
  maxBodyBytes?: number;
}

export interface HandlerArgs<B, Q> {
  req: NextRequest;
  params: Record<string, string>;
  body: B;
  query: Q;
  meta: ApiMeta;
  ctx: TenantContext | null;
  session: ResolvedSession | null;
  ip: string | null;
}

export type HandlerResult = Response | { data: unknown; status?: number; meta?: Record<string, unknown> };

type Infer<T> = T extends ZodType ? z.infer<T> : undefined;

export function clientIp(req: NextRequest): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const appUrl = new URL(process.env.APP_URL ?? req.nextUrl.origin);
    return new URL(origin).host === appUrl.host || new URL(origin).host === req.nextUrl.host;
  } catch {
    return false;
  }
}

const AUTH_ERRORS: Record<string, [string, number]> = {
  missing: ["Missing API key. Send it as: Authorization: Bearer <key>", 401],
  invalid: ["Invalid API key.", 401],
  revoked: ["This API key has been revoked.", 401],
  expired: ["This API key has expired.", 401],
  ip_not_allowed: ["Requests from this IP address are not allowed for this API key.", 403],
  org_suspended: ["This account is suspended.", 403],
};

export function apiHandler<B extends ZodType | undefined = undefined, Q extends ZodType | undefined = undefined>(
  opts: HandlerOptions<B, Q>,
  fn: (args: HandlerArgs<Infer<B>, Infer<Q>>) => Promise<HandlerResult>,
) {
  return async (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    const started = Date.now();
    const requestId = `req_${randomAlphanumeric(16)}`;
    const meta: ApiMeta = { requestId };
    const ip = clientIp(req);
    let headers: Record<string, string> = { "X-Request-Id": requestId, "Cache-Control": "no-store" };
    let ctx: TenantContext | null = null;
    let session: ResolvedSession | null = null;
    let apiKeyId: string | null = null;
    let response: Response | undefined;
    let errorCode: string | undefined;

    try {
      // ── Authentication ──
      if (opts.auth === "apiKey") {
        const auth = await authenticateApiKey(req.headers.get("authorization"), ip);
        if (typeof auth === "string") {
          await rateLimit(`api-auth-fail:${ip}`, RateLimits.apiAuthFailuresPerIp);
          const [message, status] = AUTH_ERRORS[auth];
          errorCode = auth === "ip_not_allowed" || auth === "org_suspended" ? "FORBIDDEN" : "INVALID_API_KEY";
          return fail(errorCode as "FORBIDDEN", message, meta, status, undefined, headers);
        }
        ctx = auth.ctx;
        apiKeyId = auth.apiKeyId;
        const missing = (opts.scopes ?? []).filter((s) => !auth.scopes.includes(s));
        if (missing.length) {
          throw new AppError("INSUFFICIENT_SCOPE", `This API key is missing the required scope: ${missing.join(", ")}.`);
        }
      } else if (opts.auth === "session" || opts.auth === "admin") {
        if (req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
          throw new AppError("FORBIDDEN", "Cross-origin request rejected.");
        }
        session = await getSession();
        if (!session) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
        if (opts.auth === "admin") {
          if (!platformCan(session.user.platformRole, opts.platformPermission ?? "admin:access")) {
            throw new AppError("FORBIDDEN", "Administrator access required.");
          }
        } else {
          ctx = await getTenantContext();
          if (!ctx) throw new AppError("FORBIDDEN", "No active organization.");
          if (opts.permission && !hasPermission(ctx.permissions, opts.permission)) {
            throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
          }
        }
      }

      // ── Rate limiting ──
      const rule = opts.rateLimit ?? (opts.auth === "apiKey" ? RateLimits.apiPerKey : undefined);
      if (rule) {
        const subject = apiKeyId ?? session?.user.id ?? ip ?? "anon";
        const rl: RateLimitResult = await rateLimit(`api:${req.nextUrl.pathname}:${subject}`, rule);
        headers = { ...headers, ...rateLimitHeaders(rl) };
        if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many requests. Slow down and retry after the time in the Retry-After header.");
      }

      // ── Input ──
      let rawBody = "";
      let body: unknown = undefined;
      if (opts.body) {
        const max = opts.maxBodyBytes ?? 1_000_000;
        if (Number(req.headers.get("content-length") ?? 0) > max) throw new AppError("INVALID_REQUEST", "Request body is too large.");
        rawBody = await req.text();
        if (rawBody.length > max) throw new AppError("INVALID_REQUEST", "Request body is too large.");
        let json: unknown;
        try {
          json = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          throw new AppError("INVALID_REQUEST", "Request body must be valid JSON.");
        }
        body = opts.body.parse(json);
      }
      const query = opts.query ? opts.query.parse(Object.fromEntries(req.nextUrl.searchParams)) : undefined;
      const params = await routeCtx.params;

      // ── Idempotency ──
      const idemKey = opts.idempotent ? req.headers.get("idempotency-key") : null;
      let idemRowId: string | null = null;
      if (idemKey && ctx) {
        if (idemKey.length > 255) throw new AppError("INVALID_REQUEST", "Idempotency-Key must be at most 255 characters.");
        const requestHash = sha256(`${req.method}:${req.nextUrl.pathname}:${rawBody}`);
        const existing = await db.idempotencyKey.findUnique({ where: { organizationId_key: { organizationId: ctx.organizationId, key: idemKey } } });
        if (existing) {
          if (existing.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request body.");
          if (existing.response === null) throw new AppError("CONFLICT", "A request with this Idempotency-Key is still being processed.");
          headers["Idempotent-Replayed"] = "true";
          response = Response.json(existing.response, { status: existing.statusCode ?? 200, headers });
          return response;
        }
        try {
          const row = await db.idempotencyKey.create({
            data: { organizationId: ctx.organizationId, key: idemKey, requestHash, expiresAt: new Date(Date.now() + 24 * 3600_000) },
          });
          idemRowId = row.id;
        } catch {
          throw new AppError("CONFLICT", "A request with this Idempotency-Key is still being processed.");
        }
      }

      // ── Handler ──
      try {
        const result = await fn({ req, params, body: body as Infer<B>, query: query as Infer<Q>, meta, ctx, session, ip });
        if (result instanceof Response) {
          for (const [k, v] of Object.entries(headers)) result.headers.set(k, v);
          response = result;
        } else {
          response = ok(result.data, { ...meta, ...result.meta }, { status: result.status, headers });
        }
      } catch (err) {
        if (idemRowId) await db.idempotencyKey.delete({ where: { id: idemRowId } }).catch(() => {});
        idemRowId = null;
        throw err;
      }
      if (idemRowId) {
        const payload = (await response.clone().json().catch(() => null)) as Prisma.InputJsonValue | null;
        if (response.status < 500 && payload !== null) {
          await db.idempotencyKey.update({ where: { id: idemRowId }, data: { response: payload, statusCode: response.status } });
        } else {
          await db.idempotencyKey.delete({ where: { id: idemRowId } }).catch(() => {});
        }
      }
      return response;
    } catch (err) {
      if (!(err instanceof AppError) && !(err && typeof err === "object" && "issues" in err)) {
        logger.error({ err, requestId, path: req.nextUrl.pathname }, "unhandled API error");
      }
      errorCode = err instanceof AppError ? err.code : err && typeof err === "object" && "issues" in err ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      response = errorResponse(err, meta, headers);
      return response;
    } finally {
      if (opts.auth === "apiKey" && ctx) {
        const status = response?.status ?? 500;
        trackWrite(
          db.apiLog.create({
            data: {
              organizationId: ctx.organizationId,
              apiKeyId,
              requestId,
              method: req.method,
              path: req.nextUrl.pathname,
              statusCode: status,
              durationMs: Date.now() - started,
              errorCode: status >= 400 ? errorCode : null,
              ipAddress: ip,
              userAgent: req.headers.get("user-agent")?.slice(0, 300),
            },
          }),
          "api log",
        );
      }
    }
  };
}
