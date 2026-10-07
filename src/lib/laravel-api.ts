import "server-only";
import { cookies, headers } from "next/headers";
import { isProduction } from "@/config/env";
import type { ActionResult } from "@/lib/action-result";

/**
 * The single client for the Laravel API (backend/). Server-side only: server components, server
 * actions and route handlers call Laravel server-to-server with the user's existing session token
 * as a Bearer token — the browser never talks to Laravel for dashboard data.
 *
 * NOT USED YET. The frontend still reads and writes through Prisma; this module exists so the
 * cutover can switch one feature at a time onto a single, reviewed client. See
 * docs/12-production-readiness-audit.md.
 *
 * Environment (server only, never NEXT_PUBLIC_):
 *   LARAVEL_API_URL         origin (https://smsbackend.example.com) or full base (…/api/v1)
 *   FRONTEND_PROXY_SECRET   same value as in backend/.env; lets Laravel trust the forwarded browser IP
 *   LARAVEL_API_TIMEOUT_MS  optional, default 15000
 */

// Kept in sync with SESSION_COOKIE in src/lib/auth/session.ts (not imported: that module pulls in Prisma).
const SESSION_COOKIE = isProduction() ? "__Host-sf_session" : "sf_session";
const RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;

export type LaravelErrorKind =
  | "unauthenticated" // 401: session missing/expired → sign in again
  | "forbidden" // 403: missing permission / no organization
  | "not_found" // 404 (also another organization's id)
  | "validation" // 422
  | "conflict" // 409
  | "insufficient_balance" // 402
  | "rate_limited" // 429
  | "unavailable" // 503 / 502 / 504 / network / timeout
  | "server"; // 500 and anything unexpected

/** An error answered (or not answered) by the Laravel API, with the envelope's code and details. */
export class LaravelApiError extends Error {
  constructor(
    readonly kind: LaravelErrorKind,
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "LaravelApiError";
  }

  /** Field errors in the server-action shape: details.fields[{path,message}] or details.field. */
  get fieldErrors(): Record<string, string[]> | undefined {
    const fields = this.details?.fields;
    if (Array.isArray(fields)) {
      const out: Record<string, string[]> = {};
      for (const f of fields as Array<{ path?: unknown; message?: unknown }>) {
        const key = typeof f.path === "string" && f.path ? f.path : "_";
        (out[key] ??= []).push(String(f.message ?? "Invalid value."));
      }
      return out;
    }
    const field = this.details?.field;
    return typeof field === "string" ? { [field]: [this.message] } : undefined;
  }
}

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

function baseUrl(): string {
  const url = process.env.LARAVEL_API_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new LaravelApiError("unavailable", "The service is temporarily unavailable. Please try again shortly.", 503, "LARAVEL_API_URL_MISSING");
  // Accept the bare origin (https://smsbackend.example.com) as well as the full base (…/api/v1).
  return new URL(url).pathname === "/" ? `${url}/api/v1` : url;
}

function buildUrl(path: string, query?: LaravelRequestOptions["query"]): string {
  const url = new URL(`${baseUrl()}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

async function forwardHeaders(opts: LaravelRequestOptions): Promise<Record<string, string>> {
  const h = await headers();
  const out: Record<string, string> = { Accept: "application/json" };
  const token = opts.token ?? (opts.auth === false ? undefined : (await cookies()).get(SESSION_COOKIE)?.value);
  if (token) out.Authorization = `Bearer ${token}`;
  // Browser IP for Laravel's per-IP limits and audit logs; honoured only with the shared secret.
  // Same source as getRequestMeta() in src/lib/auth/session.ts.
  const secret = process.env.FRONTEND_PROXY_SECRET;
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
  if (secret && ip) {
    out["X-SMSFlow-Client-IP"] = ip;
    out["X-SMSFlow-Proxy-Secret"] = secret;
  }
  const ua = h.get("user-agent");
  if (ua) out["User-Agent"] = ua.slice(0, 500);
  const locale = h.get("accept-language");
  if (locale) out["Accept-Language"] = locale;
  if (opts.idempotencyKey) out["Idempotency-Key"] = opts.idempotencyKey;
  return out;
}

const KIND_BY_STATUS: Record<number, LaravelErrorKind> = {
  401: "unauthenticated",
  402: "insufficient_balance",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limited",
  502: "unavailable",
  503: "unavailable",
  504: "unavailable",
};

const GENERIC: Partial<Record<LaravelErrorKind, string>> = {
  unavailable: "The service is temporarily unavailable. Please try again shortly.",
  server: "Something went wrong. Please try again.",
};

interface Envelope {
  success?: boolean;
  data?: unknown;
  meta?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

async function toError(res: Response): Promise<LaravelApiError> {
  const body = (await res.json().catch(() => null)) as Envelope | null;
  const kind = KIND_BY_STATUS[res.status] ?? "server";
  // Server errors keep a generic message; 4xx messages are written for end users by the API.
  const message = (kind === "server" ? undefined : body?.error?.message) ?? GENERIC[kind] ?? "The request could not be completed.";
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
      if (safe && attempt < MAX_RETRIES) {
        await sleep(attempt);
        continue;
      }
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new LaravelApiError("unavailable", GENERIC.unavailable!, 503, timedOut ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNREACHABLE");
    }
    if (safe && RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
      await res.body?.cancel().catch(() => undefined);
      await sleep(attempt);
      continue;
    }
    if (!res.ok) throw await toError(res);
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

export function isLaravelApiError(err: unknown): err is LaravelApiError {
  return err instanceof LaravelApiError;
}

/**
 * Maps a Laravel failure to the existing server-action result shape, so forms keep showing field
 * errors inline. Non-Laravel errors are rethrown for actionError() to handle.
 */
export function laravelActionError(err: unknown): ActionResult<never> {
  if (!isLaravelApiError(err)) throw err;
  const fieldErrors = err.kind === "validation" ? err.fieldErrors : undefined;
  return { ok: false, error: err.message, code: err.code, ...(fieldErrors ? { fieldErrors } : {}) };
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
