import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { isProduction } from "@/config/env";
import type { ActionResult } from "@/lib/action-result";
import { GENERIC_MESSAGES as GENERIC, KIND_BY_STATUS, LaravelApiError, isLaravelApiError } from "@/lib/laravel/errors";
import { logger } from "@/lib/logger";

export { LaravelApiError, isLaravelApiError };
export type { LaravelErrorKind } from "@/lib/laravel/errors";

/**
 * The single client for the Laravel API (backend/). Server-side only: server components, server
 * actions and route handlers call Laravel server-to-server with the user's existing session token
 * as a Bearer token — the browser never talks to Laravel for dashboard data.
 *
 * Every Laravel call of the frontend goes through this module (no fetch() to Laravel elsewhere).
 * Which features use it is decided per feature by LARAVEL_FEATURES (src/lib/laravel/flags.ts);
 * see docs/14-frontend-laravel-cutover-audit.md.
 *
 * Environment (server only, never NEXT_PUBLIC_):
 *   LARAVEL_API_URL         origin (https://smsbackend.example.com), …/api, or full base (…/api/v1)
 *   FRONTEND_PROXY_SECRET   same value as in backend/.env; lets Laravel trust the forwarded browser IP
 *   LARAVEL_API_TIMEOUT_MS  optional, default 15000
 */

// Kept in sync with SESSION_COOKIE in src/lib/auth/session.ts (not imported: that module pulls in Prisma).
const SESSION_COOKIE = isProduction() ? "__Host-sf_session" : "sf_session";
const RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;

export interface LaravelResponse<T> {
  data: T;
  meta: Record<string, unknown>;
  status: number;
}

export interface LaravelRequestOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined | Array<string | number>>;
  /** JSON-serialised, or a FormData passed through as multipart (contact imports, sender-ID documents). */
  body?: unknown;
  /** Required by Laravel on create/charge endpoints that are idempotent (campaign submit, payments). */
  idempotencyKey?: string;
  /** false: call without the user's session (public endpoints: login, register, password reset). */
  auth?: boolean;
  /** Override the session token (e.g. right after login, before the cookie is readable). */
  token?: string;
  timeoutMs?: number;
}

/**
 * Normalised API base ending in /api/v1. Accepts the bare origin (https://smsbackend.example.com),
 * the /api prefix, or the full base (…/api/v1), with or without a trailing slash.
 */
export function laravelBaseUrl(raw = process.env.LARAVEL_API_URL): string {
  const url = raw?.trim().replace(/\/+$/, "");
  if (!url) throw new LaravelApiError("unavailable", GENERIC.unavailable!, 503, "LARAVEL_API_URL_MISSING");
  const path = new URL(url).pathname.replace(/\/+$/, "");
  if (path === "") return `${url}/api/v1`;
  if (path.endsWith("/api")) return `${url}/v1`;
  return url;
}

function buildUrl(path: string, query?: LaravelRequestOptions["query"]): string {
  const url = new URL(`${laravelBaseUrl()}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

let warnedNoProxySecret = false;

/** Incoming request headers/cookies, or null outside a request (tests, scripts, the worker). */
async function requestScope() {
  try {
    return { h: await headers(), jar: await cookies() };
  } catch {
    return null;
  }
}

async function forwardHeaders(opts: LaravelRequestOptions): Promise<Record<string, string>> {
  const scope = await requestScope();
  const out: Record<string, string> = { Accept: "application/json" };
  const token = opts.token ?? (opts.auth === false ? undefined : scope?.jar.get(SESSION_COOKIE)?.value);
  if (token) out.Authorization = `Bearer ${token}`;
  if (scope) {
    // Browser IP for Laravel's per-IP limits and audit logs; honoured only with the shared secret.
    // Same source as getRequestMeta() in src/lib/auth/session.ts.
    const secret = process.env.FRONTEND_PROXY_SECRET;
    const ip = scope.h.get("x-forwarded-for")?.split(",")[0]?.trim() || scope.h.get("x-real-ip");
    if (secret && ip) {
      out["X-SMSFlow-Client-IP"] = ip;
      out["X-SMSFlow-Proxy-Secret"] = secret;
    } else if (!secret && isProduction() && !warnedNoProxySecret) {
      // Without it every visitor shares the Next.js server's IP in Laravel's per-IP limits
      // (login 20 / 10 min, register 5 / h): one busy hour locks everyone out.
      warnedNoProxySecret = true;
      logger.warn("FRONTEND_PROXY_SECRET is not set: Laravel sees all users as the Next.js server IP for per-IP rate limits");
    }
    const ua = scope.h.get("user-agent");
    if (ua) out["User-Agent"] = ua.slice(0, 500);
    const locale = scope.h.get("accept-language");
    if (locale) out["Accept-Language"] = locale;
  }
  if (opts.idempotencyKey) out["Idempotency-Key"] = opts.idempotencyKey;
  return out;
}

interface Envelope {
  success?: boolean;
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

async function toError(res: Response): Promise<LaravelApiError> {
  const body = (await res.json().catch(() => null)) as Envelope | null;
  const kind = KIND_BY_STATUS[res.status] ?? "server";
  // 4xx messages are written for end users by the API. 5xx: only business codes (provider errors,
  // provider not configured) keep their text; INTERNAL_ERROR, proxies and timeouts stay generic.
  const businessCode = body?.error?.code && body.error.code !== "INTERNAL_ERROR";
  const message = (kind === "server" || (kind === "unavailable" && !businessCode) ? undefined : body?.error?.message) ?? GENERIC[kind] ?? "The request could not be completed.";
  const retryAfter = Number(res.headers.get("retry-after"));
  return new LaravelApiError(
    kind,
    message,
    res.status,
    body?.error?.code,
    body?.error?.details,
    (body?.meta?.requestId as string | undefined) ?? res.headers.get("x-request-id") ?? undefined,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

/**
 * Calls the Laravel API and returns `data` + `meta` from the `{success, data, meta}` envelope.
 * Throws LaravelApiError for every non-2xx answer, timeout or network failure.
 *
 * Retries: only GET/HEAD (safe) on network errors and 502/503/504, at most twice with backoff.
 * Writes are never retried automatically — a timed-out POST may have been applied (use an
 * Idempotency-Key and let the user retry).
 */
export async function laravelFetch<T = unknown>(path: string, opts: LaravelRequestOptions = {}): Promise<LaravelResponse<T>> {
  const method = opts.method ?? (opts.body === undefined ? "GET" : "POST");
  const safe = method === "GET" || method === "HEAD";
  const url = buildUrl(path, opts.query);
  const multipart = opts.body instanceof FormData;
  const init: RequestInit = {
    method,
    // fetch sets the multipart boundary itself.
    headers: { ...(await forwardHeaders(opts)), ...(opts.body !== undefined && !multipart ? { "Content-Type": "application/json" } : {}) },
    body: multipart ? (opts.body as FormData) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    redirect: "manual",
  };
  const timeoutMs = opts.timeoutMs ?? (Number(process.env.LARAVEL_API_TIMEOUT_MS) || 15_000);

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // Next.js control flow (e.g. "this route is dynamic" during static generation) is not a network error.
      unstable_rethrow(err);
      if (safe && attempt < MAX_RETRIES) {
        await sleep(attempt);
        continue;
      }
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      logger.error({ method, path, timedOut, err: err instanceof Error ? err.message : String(err) }, "laravel api unreachable");
      throw new LaravelApiError("unavailable", GENERIC.unavailable!, 503, timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE");
    }
    if (safe && RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      await res.body?.cancel().catch(() => undefined);
      await sleep(attempt);
      continue;
    }
    if (!res.ok) {
      const error = await toError(res);
      // 5xx: the user sees a generic message; the request id ties this log line to Laravel's log.
      if (error.status >= 500) logger.error({ method, path, status: error.status, code: error.code, requestId: error.requestId }, "laravel api error");
      throw error;
    }
    if (res.status === 204 || method === "HEAD") return { data: undefined as T, meta: {}, status: res.status };
    const body = (await res.json().catch(() => null)) as Envelope | null;
    if (!body || typeof body !== "object") throw new LaravelApiError("server", GENERIC.server!, 502, "BAD_UPSTREAM_RESPONSE");
    // Most endpoints use the envelope; a few provider-style endpoints return plain JSON.
    return "success" in body ? { data: body.data as T, meta: body.meta ?? {}, status: res.status } : { data: body as T, meta: {}, status: res.status };
  }
}

function sleep(attempt: number) {
  return new Promise((r) => setTimeout(r, 250 * 2 ** attempt + Math.floor(Math.random() * 100)));
}

/** Shorthands. */
export const laravel = {
  get: <T>(path: string, query?: LaravelRequestOptions["query"], opts?: LaravelRequestOptions) => laravelFetch<T>(path, { ...opts, method: "GET", query }),
  post: <T>(path: string, body?: unknown, opts?: LaravelRequestOptions) => laravelFetch<T>(path, { ...opts, method: "POST", body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: LaravelRequestOptions) => laravelFetch<T>(path, { ...opts, method: "PUT", body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: LaravelRequestOptions) => laravelFetch<T>(path, { ...opts, method: "PATCH", body: body ?? {} }),
  delete: <T>(path: string, opts?: LaravelRequestOptions) => laravelFetch<T>(path, { ...opts, method: "DELETE" }),
};

/**
 * Maps a Laravel failure to the existing server-action result shape, so forms keep showing field
 * errors inline. Non-Laravel errors are rethrown for actionError() to handle.
 */
export function laravelActionError(err: unknown): ActionResult<never> {
  if (!isLaravelApiError(err)) throw err;
  const fieldErrors = err.fieldErrors;
  return { ok: false, error: err.userMessage, code: err.code, ...(fieldErrors ? { fieldErrors } : {}) };
}

/** Runs a Laravel call inside a server action and returns ActionResult. */
export async function toActionResult<T>(call: () => Promise<LaravelResponse<T>>, message?: string): Promise<ActionResult<T>> {
  try {
    const res = await call();
    return { ok: true, data: res.data, ...(message ? { message } : {}) };
  } catch (err) {
    return laravelActionError(err);
  }
}

/**
 * For server components: runs a Laravel read and maps the answers a page cannot render.
 * 401 → /login (session expired or revoked), 404 → the not-found page (also another tenant's id).
 * Everything else propagates to the nearest error boundary (generic message; request id logged).
 */
export async function laravelPage<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (isLaravelApiError(err)) {
      if (err.kind === "unauthenticated") redirect("/login");
      if (err.kind === "not_found") notFound();
    }
    throw err;
  }
}

/** GET returning only `data` (most page reads). */
export async function laravelData<T>(path: string, query?: LaravelRequestOptions["query"], opts?: LaravelRequestOptions): Promise<T> {
  return (await laravelFetch<T>(path, { ...opts, method: "GET", query })).data;
}

/**
 * Streams a Laravel download (CSV exports, sender-ID documents) back through a Next.js route
 * handler, so the browser downloads same-origin with its session cookie and never sees the token.
 * Only the content headers Laravel set are passed on.
 */
export async function laravelDownload(path: string, query?: LaravelRequestOptions["query"], opts: LaravelRequestOptions = {}): Promise<Response> {
  const url = buildUrl(path, query);
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let res: Response;
  try {
    res = await fetch(url, { method: "GET", headers: await forwardHeaders(opts), cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    unstable_rethrow(err);
    logger.error({ path, err: err instanceof Error ? err.message : String(err) }, "laravel download unreachable");
    throw new LaravelApiError("unavailable", GENERIC.unavailable!, 503, "UPSTREAM_UNREACHABLE");
  }
  if (!res.ok) {
    const error = await toError(res);
    if (error.status >= 500) logger.error({ path, status: error.status, code: error.code, requestId: error.requestId }, "laravel download error");
    throw error;
  }
  const out = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  for (const h of ["content-type", "content-disposition", "content-length", "x-request-id"]) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: 200, headers: out });
}
