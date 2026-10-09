import "server-only";
import type { NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { laravelBaseUrl, laravelDownload, isLaravelApiError, type LaravelRequestOptions } from "@/lib/laravel-api";
import { laravelEnabled, type LaravelFeature } from "@/lib/laravel/flags";
import { logger } from "@/lib/logger";
import { isProduction } from "@/config/env";

const SESSION_COOKIE = isProduction() ? "__Host-sf_session" : "sf_session";

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

/**
 * Route-handler helpers for the cutover. Each existing /api/** route keeps its URL (pages, emails
 * and customers keep working) and, when its feature is switched to Laravel, answers from Laravel
 * instead of the Prisma handler. Exactly one of the two runs per request.
 */

type Params = Record<string, string>;
type RouteHandler<P extends Params = Params> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

function errorJson(err: unknown): Response {
  if (isLaravelApiError(err)) {
    const status = err.status >= 500 ? (err.kind === "unavailable" ? 503 : 500) : err.status;
    return Response.json(
      { success: false, error: { code: err.code ?? (status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST"), message: err.userMessage }, meta: { requestId: err.requestId ?? null } },
      { status, headers: { "Cache-Control": "no-store", ...(err.retryAfterSeconds ? { "Retry-After": String(err.retryAfterSeconds) } : {}) } },
    );
  }
  logger.error({ err }, "laravel route failed");
  return Response.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." }, meta: {} }, { status: 500 });
}

/**
 * Session-authenticated download (CSV export, sender-ID document): streamed from Laravel with the
 * user's session token; Laravel enforces permission and tenant scope.
 */
export function downloadRoute<P extends Params = Params>(
  feature: LaravelFeature,
  target: (req: NextRequest, params: P) => { path: string; query?: LaravelRequestOptions["query"] },
  prismaHandler: RouteHandler<P>,
): RouteHandler<P> {
  return async (req, ctx) => {
    if (!laravelEnabled(feature)) return prismaHandler(req, ctx);
    try {
      const params = await ctx.params;
      const { path, query } = target(req, params);
      return await laravelDownload(path, query);
    } catch (err) {
      unstable_rethrow(err);
      return errorJson(err);
    }
  };
}

/** Query parameters copied from the incoming request (only the named ones). */
export function pickQuery(req: NextRequest, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const v = req.nextUrl.searchParams.get(n);
    if (v !== null && v !== "") out[n] = v;
  }
  return out;
}

// Headers a customer, provider or browser may legitimately send that Laravel needs to see.
const FORWARD_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "accept-language",
  "idempotency-key",
  "user-agent",
  "x-request-id",
  // Provider webhook signatures (HMAC over the raw body, which is passed through byte for byte).
  "x-smsflow-signature",
  "x-signature",
  "x-webhook-signature",
  "x-hub-signature-256",
];
const FORWARD_RESPONSE_HEADERS = ["content-type", "content-disposition", "retry-after", "x-request-id", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "location", "cache-control"];

/**
 * Transparent pass-through for endpoints whose contract is identical on both hosts (the public SMS
 * API, provider webhooks, payment returns, first-party auth JSON): same method, path, query, raw
 * body and auth header; Laravel's status, body and relevant headers come back unchanged. The
 * caller's IP is forwarded with the shared proxy secret so per-IP limits keep working.
 */
export function proxyRoute<P extends Params = Params>(
  feature: LaravelFeature,
  laravelPath: (params: P) => string,
  prismaHandler: RouteHandler<P>,
  opts: { session?: boolean } = {},
): RouteHandler<P> {
  return async (req, ctx) => {
    if (!laravelEnabled(feature)) return prismaHandler(req, ctx);
    // Cookie-authenticated JSON endpoints (admin API): same CSRF rule as apiHandler — writes must
    // come from this site's own pages.
    if (opts.session && req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
      return Response.json({ success: false, error: { code: "FORBIDDEN", message: "Cross-origin request rejected." }, meta: {} }, { status: 403 });
    }
    try {
      const params = await ctx.params;
      const url = new URL(`${laravelBaseUrl()}/${laravelPath(params).replace(/^\/+/, "")}`);
      req.nextUrl.searchParams.forEach((v, k) => url.searchParams.append(k, v));
      const headers = new Headers();
      for (const h of FORWARD_REQUEST_HEADERS) {
        const v = req.headers.get(h);
        if (v) headers.set(h, v);
      }
      if (!headers.has("accept")) headers.set("accept", "application/json");
      if (opts.session && !headers.has("authorization")) {
        // The browser's httpOnly session cookie becomes the Bearer token server-side.
        const token = req.cookies.get(SESSION_COOKIE)?.value;
        if (token) headers.set("authorization", `Bearer ${token}`);
      }
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
      const secret = process.env.FRONTEND_PROXY_SECRET;
      if (ip && secret) {
        headers.set("X-SMSFlow-Client-IP", ip);
        headers.set("X-SMSFlow-Proxy-Secret", secret);
      }
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const res = await fetch(url, {
        method: req.method,
        headers,
        body: hasBody ? await req.arrayBuffer() : undefined,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(Number(process.env.LARAVEL_API_TIMEOUT_MS) || 30_000),
      });
      const out = new Headers();
      for (const h of FORWARD_RESPONSE_HEADERS) {
        const v = res.headers.get(h);
        if (v) out.set(h, v);
      }
      return new Response(res.body, { status: res.status, headers: out });
    } catch (err) {
      unstable_rethrow(err);
      logger.error({ err: err instanceof Error ? err.message : String(err), path: req.nextUrl.pathname }, "laravel proxy failed");
      return Response.json({ success: false, error: { code: "INTERNAL_ERROR", message: "The service is temporarily unavailable. Please try again shortly." }, meta: {} }, { status: 503 });
    }
  };
}
