import { beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { drainWrites } from "@/lib/background-writes";
import { POST as sendRoute } from "@/app/api/v1/sms/send/route";
import { POST as bulkRoute } from "@/app/api/v1/sms/bulk/route";
import { GET as messageRoute } from "@/app/api/v1/messages/[id]/route";
import { GET as balanceRoute } from "@/app/api/v1/balance/route";
import { POST as smsWebhookRoute } from "@/app/api/v1/webhooks/sms/[provider]/route";
import { claimQueuedMessages, dispatchMessages } from "@/services/messaging/dispatcher";
import { MockSmsProvider } from "@/services/sms/mock-provider";
import { balanceOf, createApiKeyFor, createTenant, resetDatabase } from "../support/factories";

const url = (p: string) => `http://localhost:3000/api/v1${p}`;
const ctxOf = <P extends Record<string, string>>(params = {} as P) => ({ params: Promise.resolve(params) });
function req(path: string, init: { method?: string; key?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new NextRequest(url(path), {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("public REST API", () => {
  beforeEach(resetDatabase);

  it("rejects missing, invalid and revoked keys, and missing scopes", async () => {
    const { org } = await createTenant({ balance: 10 });
    expect((await balanceRoute(req("/balance"), ctxOf())).status).toBe(401);
    expect((await balanceRoute(req("/balance", { key: "sfk_live_nope_x" }), ctxOf())).status).toBe(401);
    const limited = await createApiKeyFor(org.id, ["sms:send"]);
    const res = await balanceRoute(req("/balance", { key: limited }), ctxOf());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_SCOPE");
    const key = await createApiKeyFor(org.id);
    await db.apiKey.updateMany({ where: { organizationId: org.id }, data: { status: "REVOKED" } });
    expect((await balanceRoute(req("/balance", { key }), ctxOf())).status).toBe(401);
  });

  it("sends, reports status through the lifecycle, and logs the request", async () => {
    const { org } = await createTenant({ balance: 10 });
    const key = await createApiKeyFor(org.id);
    const res = await sendRoute(req("/sms/send", { method: "POST", key, body: { to: "01712345678", message: "Code 123456", reference: "order-1" } }), ctxOf());
    expect(res.status).toBe(202);
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
    expect(res.headers.get("x-ratelimit-limit")).toBe("120");
    const body = await res.json();
    expect(body).toMatchObject({ success: true, data: { to: "+8801712345678", status: "queued", segments: 1, cost: "0.40" } });

    await dispatchMessages(await claimQueuedMessages(10), new MockSmsProvider());
    const status = await (await messageRoute(req(`/messages/${body.data.message_id}`, { key }), ctxOf({ id: body.data.message_id }))).json();
    expect(status.data).toMatchObject({ status: "submitted", reference: "order-1" });
    expect(status.data.events.map((e: { status: string }) => e.status)).toEqual(["submitted"]);

    await drainWrites();
    expect(await db.apiLog.count({ where: { organizationId: org.id, statusCode: 202 } })).toBe(1);
  });

  it("replays idempotent requests without sending twice and rejects key reuse with a different body", async () => {
    const { org } = await createTenant({ balance: 10 });
    const key = await createApiKeyFor(org.id);
    const send = (message: string) => sendRoute(req("/sms/send", { method: "POST", key, body: { to: "01712345678", message }, headers: { "idempotency-key": "order-42" } }), ctxOf());
    const first = await send("Hello");
    const second = await send("Hello");
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect((await second.json()).data.message_id).toBe((await first.json()).data.message_id);
    expect(await db.message.count()).toBe(1);
    expect(await balanceOf(org.id)).toBeCloseTo(9.6);
    const conflict = await send("Different");
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("returns field-level validation errors and rejects unknown fields", async () => {
    const { org } = await createTenant({ balance: 10 });
    const key = await createApiKeyFor(org.id);
    const res = await sendRoute(req("/sms/send", { method: "POST", key, body: { message: "x", colour: "blue" } }), ctxOf());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fields.map((f: { path: string }) => f.path)).toContain("to");
  });

  it("accepts bulk requests partially and reports per-recipient errors", async () => {
    const { org } = await createTenant({ balance: 10 });
    const key = await createApiKeyFor(org.id);
    const res = await bulkRoute(req("/sms/bulk", { method: "POST", key, body: { message: "Hi {{name}}", recipients: [{ to: "01712345671", variables: { name: "Rahim" } }, "01712345672", "bad"] } }), ctxOf());
    const body = await res.json();
    expect(body.data).toMatchObject({ accepted: 2, rejected: 1, total_cost: "0.80" });
    expect(body.data.errors[0]).toMatchObject({ to: "bad", code: "INVALID_RECIPIENT" });
    expect((await db.message.findFirstOrThrow({ where: { to: "+8801712345671" } })).body).toBe("Hi Rahim");
  });

  it("isolates tenants: a message id from another organization is not found", async () => {
    const a = await createTenant({ balance: 10, name: "A" });
    const b = await createTenant({ balance: 10, name: "B" });
    const keyA = await createApiKeyFor(a.org.id);
    const keyB = await createApiKeyFor(b.org.id);
    const sent = await (await sendRoute(req("/sms/send", { method: "POST", key: keyA, body: { to: "01712345678", message: "x" } }), ctxOf())).json();
    const res = await messageRoute(req(`/messages/${sent.data.message_id}`, { key: keyB }), ctxOf({ id: sent.data.message_id }));
    expect(res.status).toBe(404);
  });

  it("rejects suspended organizations", async () => {
    const { org } = await createTenant({ balance: 10 });
    const key = await createApiKeyFor(org.id);
    await db.organization.update({ where: { id: org.id }, data: { status: "SUSPENDED" } });
    const res = await sendRoute(req("/sms/send", { method: "POST", key, body: { to: "01712345678", message: "x" } }), ctxOf());
    expect(res.status).toBe(403);
  });
});

describe("provider delivery webhook", () => {
  beforeEach(resetDatabase);

  it("requires a valid signature, applies events once, and refunds failures", async () => {
    const { org } = await createTenant({ balance: 10 });
    const key = await createApiKeyFor(org.id);
    await sendRoute(req("/sms/send", { method: "POST", key, body: { to: "01712345678", message: "x" } }), ctxOf());
    await dispatchMessages(await claimQueuedMessages(10), new MockSmsProvider(process.env.SMS_PROVIDER_WEBHOOK_SECRET));
    const msg = await db.message.findFirstOrThrow({});
    const payload = JSON.stringify({ events: [{ message_id: msg.providerMessageId, status: "UNDELIV", timestamp: "2026-09-30T10:00:00Z", description: "Unreachable" }] });
    const hook = (sig: string) =>
      smsWebhookRoute(new NextRequest(url("/webhooks/sms/mock"), { method: "POST", headers: { "content-type": "application/json", "x-signature": sig }, body: payload }), ctxOf({ provider: "mock" }));
    expect((await hook("forged")).status).toBe(401);
    const sig = createHmac("sha256", process.env.SMS_PROVIDER_WEBHOOK_SECRET!).update(payload).digest("hex");
    expect(await (await hook(sig)).json()).toMatchObject({ ok: true, applied: 1 });
    expect(await (await hook(sig)).json()).toMatchObject({ ok: true, applied: 0 }); // replay
    expect((await db.message.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe("FAILED");
    expect(await balanceOf(org.id)).toBeCloseTo(10);
  });
});
