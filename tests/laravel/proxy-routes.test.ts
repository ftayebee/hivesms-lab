import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as smsSend } from "@/app/api/v1/sms/send/route";
import { POST as smsBulk } from "@/app/api/v1/sms/bulk/route";
import { POST as smsEstimate } from "@/app/api/v1/sms/estimate/route";
import { GET as balance } from "@/app/api/v1/balance/route";
import { GET as messages } from "@/app/api/v1/messages/route";
import { GET as message } from "@/app/api/v1/messages/[id]/route";
import { GET as senderIds } from "@/app/api/v1/sender-ids/route";
import { POST as smsWebhook } from "@/app/api/v1/webhooks/sms/[provider]/route";
import { POST as smsInbound } from "@/app/api/v1/webhooks/sms/[provider]/inbound/route";
import { POST as paymentIpn } from "@/app/api/v1/webhooks/payments/[provider]/route";
import { GET as paymentReturnGet, POST as paymentReturnPost } from "@/app/api/v1/payments/[provider]/return/route";
import { api, createApiKey, mockTopUp, nextRequest, params, phone, poll, register, RUN, type TestAccount } from "../support/laravel-helpers";

/**
 * The Next.js route handlers that keep their URLs on this domain and proxy to Laravel
 * (LARAVEL_FEATURES `publicApi` and `webhooks`): customer SMS API, provider webhooks, payment
 * IPN and payment return. The real handlers are called with a NextRequest, so the proxy layer
 * (headers, raw body, status, redirects) is what is being tested — against a LOCAL Laravel with
 * the mock SMS provider and mock payments only:
 *
 *   LARAVEL_TEST_API_URL=http://127.0.0.1:8000 LARAVEL_TEST_DATABASE_URL=mysql://root@127.0.0.1:3306/smsflow_cutover \
 *   LARAVEL_TEST_PROXY_SECRET=<backend FRONTEND_PROXY_SECRET> [LARAVEL_TEST_SMS_WEBHOOK_SECRET=<backend SMS_PROVIDER_WEBHOOK_SECRET>] \
 *     npx vitest run --project laravel
 *
 * With LARAVEL_TEST_SMS_WEBHOOK_SECRET the delivery/inbound webhooks are HMAC-signed and a
 * tampered body must be rejected; without it the local backend accepts unsigned mock webhooks.
 */

const WEBHOOK_SECRET = process.env.LARAVEL_TEST_SMS_WEBHOOK_SECRET ?? "";
const sign = (body: string): Record<string, string> => (WEBHOOK_SECRET ? { "x-signature": createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex") } : {});

/** Envelope answers (customer API) and plain provider-style answers (webhooks) in one loose shape. */
interface ProxyBody {
  success?: boolean;
  data: { balance?: string; message_id?: string } & Record<string, unknown>;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string };
  ok?: boolean;
  optOuts?: number;
  received?: boolean;
  outcome?: string;
}
const json = async (res: Response) => (await res.json()) as ProxyBody;

let a: TestAccount;
let keyA: string;
let keyB: string;
const to = phone();
let messageId: string;

beforeAll(async () => {
  a = await register("proxy-a", { verified: true });
  const b = await register("proxy-b", { verified: true });
  await mockTopUp(a.token, 600);
  keyA = await createApiKey(a.token);
  keyB = await createApiKey(b.token);
});

const bearer = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });

describe("customer SMS API through Next.js (publicApi)", () => {
  it("balance: answered by Laravel with the API key's organization", async () => {
    const res = await balance(nextRequest("/api/v1/balance", { headers: bearer(keyA) }), params({}));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(Number(body.data.balance)).toBeGreaterThanOrEqual(600);
    expect(String(body.meta?.requestId)).toMatch(/^req_/); // Laravel's envelope, not the Prisma handler's
  });

  it("estimate and send (202), with the Idempotency-Key honoured through the proxy", async () => {
    const est = await smsEstimate(nextRequest("/api/v1/sms/estimate", { method: "POST", headers: bearer(keyA), body: JSON.stringify({ message: "Cutover estimate", recipients: 1 }) }), params({}));
    expect(est.status, JSON.stringify(await est.clone().json())).toBe(200);

    const key = `idem-${RUN}`;
    const body = JSON.stringify({ to, message: `Cutover proxy ${RUN}` });
    const first = await smsSend(nextRequest("/api/v1/sms/send", { method: "POST", headers: { ...bearer(keyA), "idempotency-key": key }, body }), params({}));
    const firstBody = await json(first);
    expect(first.status, JSON.stringify(firstBody)).toBe(202);
    messageId = firstBody.data.message_id!;
    expect(messageId).toBeTruthy();
    const again = await smsSend(nextRequest("/api/v1/sms/send", { method: "POST", headers: { ...bearer(keyA), "idempotency-key": key }, body }), params({}));
    expect((await json(again)).data.message_id).toBe(messageId);
    expect(await db.message.count({ where: { to: { endsWith: to.slice(-10) }, organizationId: a.organizationId! } })).toBe(1);
  });

  it("bulk send through the proxy", async () => {
    const res = await smsBulk(nextRequest("/api/v1/sms/bulk", { method: "POST", headers: bearer(keyA), body: JSON.stringify({ recipients: [phone(), phone()], message: "Cutover bulk" }) }), params({}));
    const body = await json(res);
    expect(res.status, JSON.stringify(body)).toBe(202);
  });

  it("validation, authentication and cookie handling are Laravel's (422 / 401 passed through)", async () => {
    const bad = await smsSend(nextRequest("/api/v1/sms/send", { method: "POST", headers: bearer(keyA), body: JSON.stringify({ to: "12345", message: "x" }) }), params({}));
    expect(bad.status).toBe(422);
    expect((await json(bad)).error?.code).toBeTruthy();

    const noKey = await balance(nextRequest("/api/v1/balance"), params({}));
    expect(noKey.status).toBe(401);
    const wrongKey = await balance(nextRequest("/api/v1/balance", { headers: bearer("sfk_live_not_a_real_key_000000000000") }), params({}));
    expect(wrongKey.status).toBe(401);
    // The dashboard session cookie is NOT forwarded on public API routes: it can't stand in for an API key.
    const cookieOnly = await balance(nextRequest("/api/v1/balance", { headers: { cookie: `sf_session=${a.token}` } }), params({}));
    expect(cookieOnly.status).toBe(401);
    // …and a session token is not an API key either.
    const sessionAsKey = await balance(nextRequest("/api/v1/balance", { headers: bearer(a.token) }), params({}));
    expect(sessionAsKey.status).toBe(401);
  });

  it("messages list/detail and sender IDs; another organization's message is 404", async () => {
    const list = await messages(nextRequest("/api/v1/messages?limit=10", { headers: bearer(keyA) }), params({}));
    expect(list.status).toBe(200);
    expect(JSON.stringify((await json(list)).data)).toContain(messageId);

    const one = await message(nextRequest(`/api/v1/messages/${messageId}`, { headers: bearer(keyA) }), params({ id: messageId }));
    expect(one.status).toBe(200);

    const other = await message(nextRequest(`/api/v1/messages/${messageId}`, { headers: bearer(keyB) }), params({ id: messageId }));
    expect(other.status).toBe(404);
    const otherList = await messages(nextRequest("/api/v1/messages", { headers: bearer(keyB) }), params({}));
    expect(JSON.stringify((await json(otherList)).data)).not.toContain(messageId);

    const sids = await senderIds(nextRequest("/api/v1/sender-ids", { headers: bearer(keyA) }), params({}));
    expect(sids.status).toBe(200);
  });
});

describe("provider webhooks through Next.js (webhooks)", () => {
  it("delivery report: raw body (and signature) reach Laravel unchanged; the message becomes DELIVERED", async () => {
    // The mock provider accepted the message after the response; wait for its provider id.
    const sent = await poll(() => db.message.findFirst({ where: { id: messageId, providerMessageId: { not: null } }, select: { providerMessageId: true } }));
    const body = JSON.stringify({ events: [{ message_id: sent.providerMessageId, status: "DELIVERED", timestamp: new Date().toISOString() }] });
    const res = await smsWebhook(nextRequest("/api/v1/webhooks/sms/mock", { method: "POST", headers: { "content-type": "application/json", ...sign(body) }, body }), params({ provider: "mock" }));
    const out = await json(res);
    expect(res.status, JSON.stringify(out)).toBe(200);
    expect(out.ok).toBe(true);
    const status = await poll(async () => {
      const m = await db.message.findUnique({ where: { id: messageId }, select: { status: true } });
      return m?.status === "DELIVERED" ? m.status : null;
    });
    expect(status).toBe("DELIVERED");
    // Replays are acknowledged and ignored.
    const replay = await smsWebhook(nextRequest("/api/v1/webhooks/sms/mock", { method: "POST", headers: { "content-type": "application/json", ...sign(body) }, body }), params({ provider: "mock" }));
    expect(replay.status).toBe(200);
  });

  it.runIf(WEBHOOK_SECRET)("rejects a delivery report whose body was changed after signing (401)", async () => {
    const body = JSON.stringify({ events: [{ message_id: "mock_d_x_tampered", status: "DELIVERED" }] });
    const headers = { "content-type": "application/json", ...sign(body) };
    const res = await smsWebhook(nextRequest("/api/v1/webhooks/sms/mock", { method: "POST", headers, body: body.replace("DELIVERED", "FAILED") }), params({ provider: "mock" }));
    expect(res.status).toBe(401);
    const unsigned = await smsWebhook(nextRequest("/api/v1/webhooks/sms/mock", { method: "POST", headers: { "content-type": "application/json" }, body }), params({ provider: "mock" }));
    expect(unsigned.status).toBe(401);
  });

  it("unknown SMS provider → 404", async () => {
    const res = await smsWebhook(nextRequest("/api/v1/webhooks/sms/nope", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), params({ provider: "nope" }));
    expect(res.status).toBe(404);
  });

  it("inbound STOP opts the number out for the organization that messaged it", async () => {
    const body = JSON.stringify({ messages: [{ id: `in-${RUN}`, from: to, to: "8809600000000", text: "STOP" }] });
    const res = await smsInbound(nextRequest("/api/v1/webhooks/sms/mock/inbound", { method: "POST", headers: { "content-type": "application/json", ...sign(body) }, body }), params({ provider: "mock" }));
    const out = await json(res);
    expect(res.status, JSON.stringify(out)).toBe(200);
    expect(out.optOuts).toBe(1);
    const sup = await api<Array<{ phone: string }>>("app/suppression", { token: a.token });
    expect(sup.status).toBe(200);
    expect(sup.json!.data.map((s) => s.phone.slice(-10))).toContain(to.slice(-10));
  });
});

describe("payment IPN and browser return through Next.js (webhooks)", () => {
  let paymentId: string;
  const balanceOf = async () => (await db.wallet.findUniqueOrThrow({ where: { organizationId: a.organizationId! } })).balance.toString();

  beforeAll(async () => {
    const r = await api<{ payment: { id: string } }>("app/payments", { token: a.token, body: { amount: 700, provider: "mock" }, headers: { "Idempotency-Key": `ipn-${RUN}` } });
    expect(r.status).toBe(201);
    paymentId = r.json!.data.payment.id;
  });

  it("a forged IPN never credits the wallet (the mock gateway has no server-verified callbacks)", async () => {
    const before = await balanceOf();
    const form = new URLSearchParams({ paymentId, status: "success", amount: "700" });
    const res = await paymentIpn(
      nextRequest("/api/v1/webhooks/payments/mock", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form.toString() }),
      params({ provider: "mock" }),
    );
    const out = await json(res);
    expect(res.status, JSON.stringify(out)).toBe(200);
    expect(out.received).toBe(true);
    expect(out.outcome).not.toBe("succeeded");
    expect(await balanceOf()).toBe(before);
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
  });

  it("browser return (GET and form POST) redirects 303 to the frontend wallet page, without crediting", async () => {
    const before = await balanceOf();
    const get = await paymentReturnGet(nextRequest(`/api/v1/payments/mock/return?paymentId=${paymentId}&status=success`), params({ provider: "mock" }));
    expect(get.status).toBe(303);
    const location = get.headers.get("location")!;
    expect(new URL(location).pathname).toMatch(/^\/dashboard\/wallet/);
    // Laravel builds it from FRONTEND_URL: it must be this Next.js app's origin (checked in the rollout).
    expect(location).not.toContain("/api/v1/");

    const post = await paymentReturnPost(
      nextRequest("/api/v1/payments/mock/return", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ paymentId, status: "VALID" }).toString() }),
      params({ provider: "mock" }),
    );
    expect(post.status).toBe(303);
    expect(await balanceOf()).toBe(before);

    const unknown = await paymentReturnGet(nextRequest("/api/v1/payments/nope/return"), params({ provider: "nope" }));
    expect(unknown.status).toBe(303);
    expect(unknown.headers.get("location")).toContain("/dashboard/wallet?payment=unknown");
  });
});
