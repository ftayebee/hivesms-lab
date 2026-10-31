import { expect } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import type { LaravelIssuedSession, LaravelMe } from "@/lib/laravel/session";

/**
 * Shared helpers for the `laravel` Vitest project (local Laravel + local database only; the
 * setup file refuses anything else). Accounts are created through Laravel's own API.
 */

export const BASE = process.env.LARAVEL_API_URL!.replace(/\/+$/, "") + (/\/api\/v1$/.test(process.env.LARAVEL_API_URL!) ? "" : "/api/v1");
export const RUN = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
export const PASSWORD = "Cutover-Test-Pass-2026";

let phoneSeq = Math.floor(Math.random() * 1e6);
/** Unique BD mobile number; never ends in the mock provider's simulated-failure suffixes (0000/8888/9999). */
export const phone = () => `0171${String(Date.now() % 1e5).padStart(5, "0")}${String((phoneSeq++ % 89) + 10)}`;

export interface Envelope<T> {
  success: boolean;
  data: T;
  meta: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      Accept: "application/json",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  return { status: res.status, json, headers: res.headers };
}

// Per-visitor IP with the shared proxy secret (as the Next.js server sends it), so Laravel's per-IP
// registration limit (5 / h) applies per test account instead of to the whole run.
let ipSeq = Math.floor(Math.random() * 200);
export const asClient = (): Record<string, string> =>
  process.env.LARAVEL_TEST_PROXY_SECRET ? { "X-SMSFlow-Client-IP": `10.78.${ipSeq % 250}.${(ipSeq++ % 250) + 1}`, "X-SMSFlow-Proxy-Secret": process.env.LARAVEL_TEST_PROXY_SECRET } : {};

export interface TestAccount extends LaravelIssuedSession {
  email: string;
}

/** Registers an owner account + organization through Laravel; `verified` marks the email verified in the local test DB. */
export async function register(tag: string, opts: { verified?: boolean } = {}): Promise<TestAccount> {
  const email = `cutover-${tag}-${RUN}@example.com`;
  const r = await api<LaravelIssuedSession>("auth/register", {
    headers: asClient(),
    body: { name: `Cutover ${tag}`, company: `Cutover ${tag} ${RUN}`, email, phone: phone(), password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true },
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  if (opts.verified) await db.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
  return { email, ...r.json!.data };
}

export async function me(token: string): Promise<LaravelMe> {
  const r = await api<LaravelMe>("auth/me", { token });
  expect(r.status).toBe(200);
  return r.json!.data;
}

/** Credits the wallet through the MOCK gateway (local stack: ALLOW_MOCK_PAYMENTS=true). No real payment. */
export async function mockTopUp(token: string, amount = 600) {
  const created = await api<{ payment: { id: string } }>("app/payments", { token, body: { amount, provider: "mock" }, headers: { "Idempotency-Key": `topup-${RUN}-${Math.random()}` } });
  expect(created.status, JSON.stringify(created.json)).toBe(201);
  const id = created.json!.data.payment.id;
  const done = await api(`app/payments/${id}/mock-complete`, { token, body: { outcome: "success" } });
  expect(done.status, JSON.stringify(done.json)).toBe(200);
  return id;
}

/** Customer API key with every public-API scope; the plaintext key is only returned once. */
export async function createApiKey(token: string): Promise<string> {
  const r = await api<{ key: string }>("app/api-keys", {
    token,
    body: { name: `Cutover ${RUN}`, scopes: ["sms:send", "messages:read", "balance:read", "sender_ids:read"] },
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  expect(r.json!.data.key).toMatch(/^sfk_/);
  return r.json!.data.key;
}

/** Builds the request a Next.js route handler receives (as if the browser/customer called this app). */
export function nextRequest(path: string, init: { method?: string; headers?: Record<string, string>; body?: string | URLSearchParams } = {}) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { method: init.method ?? "GET", headers: init.headers, body: init.body });
}

export const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });

export async function poll<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error("poll timed out");
    await new Promise((r) => setTimeout(r, 300));
  }
}
