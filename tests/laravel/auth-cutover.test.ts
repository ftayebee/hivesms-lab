import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { laravelFetch, LaravelApiError } from "@/lib/laravel-api";
import { createSession, resolveSessionToken } from "@/lib/auth/session-store";
import { sessionFromMe, tenantFromMe, type LaravelIssuedSession, type LaravelMe } from "@/lib/laravel/session";

/**
 * Authentication after the cutover (LARAVEL_FEATURES `auth`), against a local Laravel + database:
 *
 *   LARAVEL_TEST_API_URL=http://127.0.0.1:8000 LARAVEL_TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/smsflow_cutover \
 *     npx vitest run --project laravel
 *
 * Design being verified: the browser only talks to Next.js; the Next.js server sends the session
 * token from its httpOnly cookie to Laravel as a Bearer token. There is one session system (the
 * `sessions` table, sha256 of the token), shared by both backends during the transition.
 */

const BASE = process.env.LARAVEL_API_URL!.replace(/\/+$/, "") + (/\/api\/v1$/.test(process.env.LARAVEL_API_URL!) ? "" : "/api/v1");
const run = Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
let phoneSeq = Math.floor(Math.random() * 1e6);
const phone = () => `0171${String(Date.now() % 1e5).padStart(5, "0")}${String(phoneSeq++ % 100).padStart(2, "0")}`;
const PASSWORD = "Cutover-Test-Pass-2026";

async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
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
  const json = (await res.json().catch(() => null)) as { success: boolean; data: T; meta: Record<string, unknown>; error?: { code: string; message: string; details?: unknown } } | null;
  return { status: res.status, json, headers: res.headers };
}

// The Next.js server forwards the browser IP with the shared proxy secret, so Laravel's per-IP limits
// (register 5 / h) apply per visitor, not to the Next.js server as a whole. The test does the same.
let ipSeq = Math.floor(Math.random() * 200);
const asClient = (): Record<string, string> =>
  process.env.LARAVEL_TEST_PROXY_SECRET ? { "X-SMSFlow-Client-IP": `10.77.${ipSeq % 250}.${(ipSeq++ % 250) + 1}`, "X-SMSFlow-Proxy-Secret": process.env.LARAVEL_TEST_PROXY_SECRET } : {};

async function register(tag: string) {
  const email = `cutover-${tag}-${run}@example.com`;
  const r = await api<LaravelIssuedSession>("auth/register", {
    headers: asClient(),
    body: { name: `Cutover ${tag}`, company: `Cutover ${tag} ${run}`, email, phone: phone(), password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true },
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return { email, ...r.json!.data };
}

describe("auth through Laravel", () => {
  it("registers, stores only an argon2id hash and only sha256(token), and returns no secrets", async () => {
    const u = await register("reg");
    expect(u.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(u.persistent).toBe(false);
    expect(u.organizationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(u)).not.toMatch(/passwordHash|argon2|tokenHash/);

    const user = await db.user.findUniqueOrThrow({ where: { email: u.email } });
    expect(user.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(user.passwordHash).not.toContain(PASSWORD);
    const session = await db.session.findUniqueOrThrow({ where: { tokenHash: sha256(u.token) } });
    expect(session.userId).toBe(user.id);
    expect(await db.session.count({ where: { tokenHash: u.token } })).toBe(0);
  });

  it("logs in by email or BD mobile number, rejects wrong passwords without telling which part was wrong", async () => {
    const u = await register("login");
    const bad = await api("auth/login", { body: { identifier: u.email, password: "Wrong-Password-123" } });
    expect(bad.status).toBe(401);
    const unknown = await api("auth/login", { body: { identifier: `nobody-${run}@example.com`, password: "Wrong-Password-123" } });
    expect(unknown.status).toBe(401);
    expect(unknown.json!.error!.message).toBe(bad.json!.error!.message);

    const byEmail = await api<LaravelIssuedSession>("auth/login", { body: { identifier: u.email.toUpperCase(), password: PASSWORD, remember: true } });
    expect(byEmail.status).toBe(200);
    expect(byEmail.json!.data.persistent).toBe(true);
    const user = await db.user.findUniqueOrThrow({ where: { email: u.email } });
    const byPhone = await api<LaravelIssuedSession>("auth/login", { body: { identifier: user.phone!.replace(/^\+?880/, "0"), password: PASSWORD } });
    expect(byPhone.status).toBe(200);
  });

  it("resolves the current user and tenant (/auth/me) and keeps the session across requests", async () => {
    const u = await register("me");
    for (let i = 0; i < 2; i++) {
      const me = await api<LaravelMe>("auth/me", { token: u.token });
      expect(me.status).toBe(200);
      const session = sessionFromMe(me.json!.data);
      expect(session.user.email).toBe(u.email);
      expect(session.activeOrganizationId).toBe(u.organizationId);
      expect(session.expiresAt).toBeInstanceOf(Date);
      const ctx = tenantFromMe(me.json!.data)!;
      expect(ctx.organizationId).toBe(u.organizationId);
      expect(ctx.roleKey).toBe("OWNER");
      expect(ctx.permissions).toContain("contacts:write");
      expect(me.json!.data.organization!.balance).toBe("0.00");
    }
  });

  it("rejects requests without a valid session (401), including API keys used as session tokens", async () => {
    expect((await api("auth/me")).status).toBe(401);
    expect((await api("auth/me", { token: "not-a-real-token" })).status).toBe(401);
    expect((await api("auth/me", { token: "sfk_live_abcdefghijklmnopqrstuvwxyz" })).status).toBe(401);
    expect((await api("app/contacts", { token: "not-a-real-token" })).status).toBe(401);
    // The typed client turns it into `unauthenticated` (pages redirect to /login).
    const err = (await laravelFetch("auth/me", { token: "not-a-real-token" }).catch((e) => e)) as LaravelApiError;
    expect(err).toBeInstanceOf(LaravelApiError);
    expect(err.kind).toBe("unauthenticated");
    expect(err.requestId).toMatch(/^req_/);
  });

  it("logout revokes the session; expired sessions are rejected and removed", async () => {
    const u = await register("logout");
    expect((await api("auth/logout", { method: "POST", token: u.token, body: {} })).status).toBe(200);
    expect((await api("auth/me", { token: u.token })).status).toBe(401);
    expect(await db.session.count({ where: { tokenHash: sha256(u.token) } })).toBe(0);

    const login = await api<LaravelIssuedSession>("auth/login", { body: { identifier: u.email, password: PASSWORD } });
    const token = login.json!.data.token;
    await db.session.update({ where: { tokenHash: sha256(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await api("auth/me", { token })).status).toBe(401);
    expect(await db.session.count({ where: { tokenHash: sha256(token) } })).toBe(0);
  });

  it("changing the password signs out the other sessions but keeps the current one", async () => {
    const u = await register("pw");
    const other = (await api<LaravelIssuedSession>("auth/login", { body: { identifier: u.email, password: PASSWORD } })).json!.data.token;
    const wrong = await api("profile/password", { method: "PUT", token: u.token, body: { currentPassword: "nope-nope-nope", password: "Another-Pass-2026", confirmPassword: "Another-Pass-2026" } });
    expect([401, 422]).toContain(wrong.status);
    const ok = await api("profile/password", { method: "PUT", token: u.token, body: { currentPassword: PASSWORD, password: "Another-Pass-2026", confirmPassword: "Another-Pass-2026" } });
    expect(ok.status).toBe(200);
    expect((await api("auth/me", { token: other })).status).toBe(401);
    expect((await api("auth/me", { token: u.token })).status).toBe(200);
  });

  it("shares sessions with the Node implementation in both directions (no logout at cutover, safe rollback)", async () => {
    const u = await register("compat");
    const user = await db.user.findUniqueOrThrow({ where: { email: u.email } });
    // A session created by the Next.js/Prisma code is accepted by Laravel…
    const node = await createSession({ userId: user.id, organizationId: u.organizationId, remember: false, ip: "127.0.0.1", userAgent: "vitest" });
    const me = await api<LaravelMe>("auth/me", { token: node.token });
    expect(me.status).toBe(200);
    expect(me.json!.data.user.id).toBe(user.id);
    // …and a session created by Laravel is accepted by the Prisma code (feature flag rolled back).
    const resolved = await resolveSessionToken(u.token);
    expect(resolved?.user.id).toBe(user.id);
    expect(resolved?.activeOrganizationId).toBe(u.organizationId);
  });

  it("CORS never allows credentials; the browser is not meant to call the API with cookies", async () => {
    const res = await fetch(`${BASE}/auth/me`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" } });
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(res.headers.get("access-control-allow-origin") ?? "").not.toBe("https://evil.example");
  });
});

describe("tenant isolation", () => {
  it("another organization's ids answer 404 and never leak data", async () => {
    const a = await register("tenant-a");
    const b = await register("tenant-b");
    const contact = await api<{ id: string }>("app/contacts", { token: a.token, body: { name: "Alice A", phone: phone(), groupIds: [], tags: ["vip"] } });
    expect(contact.status).toBe(201);
    const id = contact.json!.data.id;

    expect((await api(`app/contacts/${id}`, { token: b.token })).status).toBe(404);
    expect((await api(`app/contacts/${id}`, { method: "PUT", token: b.token, body: { name: "Mallory", phone: phone() } })).status).toBe(404);
    expect((await api(`app/contacts/${id}`, { method: "DELETE", token: b.token })).status).toBe(404);
    const bulk = await api<{ updated: number }>("app/contacts/bulk", { token: b.token, body: { ids: [id], action: { type: "delete" } } });
    expect(bulk.json!.data.updated).toBe(0);
    const listB = await api<Array<{ id: string }>>("app/contacts", { token: b.token });
    expect(listB.json!.data.map((c) => c.id)).not.toContain(id);
    // Still there for its owner.
    expect((await api(`app/contacts/${id}`, { token: a.token })).status).toBe(200);
  });

  it("customers cannot reach admin endpoints (403), whatever the UI shows", async () => {
    const u = await register("not-admin");
    for (const path of ["admin/overview", "admin/customers", "admin/users", "admin/settings"]) {
      expect((await api(path, { token: u.token })).status, path).toBe(403);
    }
  });
});
