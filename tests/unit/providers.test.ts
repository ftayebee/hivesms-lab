import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { MockSmsProvider } from "@/services/sms/mock-provider";
import { HttpSmsProvider } from "@/services/sms/http-provider";
import { basicSenderIdValidation, type SendSmsInput } from "@/services/sms/types";

const input = (to: string): SendSmsInput => ({ reference: "r1", to, message: "Hello", senderId: "BRAND", senderType: "MASKING", smsType: "TRANSACTIONAL", encoding: "GSM7" });

describe("mock SMS provider", () => {
  const p = new MockSmsProvider("whsec_test");

  it("accepts ordinary numbers and reports delivery after the delay", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    const r = await p.sendSms(input("+8801712345678"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await p.getDeliveryStatus(r.providerMessageId)).status).toBe("SUBMITTED");
    vi.setSystemTime(new Date("2026-09-30T10:00:05Z"));
    expect((await p.getDeliveryStatus(r.providerMessageId)).status).toBe("DELIVERED");
    vi.useRealTimers();
  });

  it("simulates rejection, temporary errors and handset failure deterministically", async () => {
    const rejected = await p.sendSms(input("+8801712340000"));
    expect(rejected).toMatchObject({ ok: false, retryable: false });
    const transient = await p.sendSms(input("+8801712348888"));
    expect(transient).toMatchObject({ ok: false, retryable: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    const fails = await p.sendSms(input("+8801712349999"));
    expect(fails.ok).toBe(true);
    vi.setSystemTime(new Date("2026-09-30T10:00:10Z"));
    if (fails.ok) expect((await p.getDeliveryStatus(fails.providerMessageId)).status).toBe("FAILED");
    vi.useRealTimers();
  });

  it("verifies webhook signatures and parses events with stable dedupe keys", async () => {
    const body = JSON.stringify({ events: [{ message_id: "mock_d_1", status: "DELIVRD", timestamp: "2026-09-30T10:00:00Z" }] });
    const sig = createHmac("sha256", "whsec_test").update(body).digest("hex");
    const req = (s: string) => ({ headers: new Headers({ "x-signature": s }), rawBody: body, query: new URLSearchParams() });
    expect(await p.verifyWebhook(req(sig))).toBe(true);
    expect(await p.verifyWebhook(req("bad"))).toBe(false);
    const [ev] = await p.parseDeliveryWebhook(req(sig));
    expect(ev).toMatchObject({ providerMessageId: "mock_d_1", status: "DELIVERED" });
    const [again] = await p.parseDeliveryWebhook(req(sig));
    expect(again.eventKey).toBe(ev.eventKey);
  });
});

describe("generic HTTP provider", () => {
  afterEach(() => vi.unstubAllGlobals());
  const make = () => new HttpSmsProvider({ url: "https://gw.example/send", apiKey: "k", apiSecret: "", webhookSecret: "s3cret", mapping: { message: "text" } });

  it("posts mapped parameters and reads the provider message id", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = new URLSearchParams(String(init.body));
      expect(form.get("text")).toBe("Hello");
      expect(form.get("to")).toBe("8801712345678");
      expect(form.get("api_key")).toBe("k");
      return new Response(JSON.stringify({ error: 0, data: { request_id: 42 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await make().sendSms(input("+8801712345678"));
    expect(r).toMatchObject({ ok: true, providerMessageId: "42" });
  });

  it("treats 5xx and 429 as retryable and business errors as final", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await make().sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: 405, msg: "Invalid sender" }), { status: 200 })));
    expect(await make().sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: false, errorMessage: "Invalid sender" });
  });

  it("reports missing configuration without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const p = new HttpSmsProvider({ url: "", apiKey: "", apiSecret: "", webhookSecret: "" });
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, errorCode: "PROVIDER_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never accepts unsigned webhooks", async () => {
    const p = new HttpSmsProvider({ url: "x", apiKey: "k", apiSecret: "", webhookSecret: "" });
    expect(await p.verifyWebhook({ headers: new Headers(), rawBody: "{}", query: new URLSearchParams() })).toBe(false);
  });
});

describe("sender ID format checks", () => {
  it("validates masking and numeric senders", () => {
    expect(basicSenderIdValidation("YOURBRAND", "MASKING").valid).toBe(true);
    expect(basicSenderIdValidation("AB", "MASKING").valid).toBe(false);
    expect(basicSenderIdValidation("123456", "MASKING").valid).toBe(false);
    expect(basicSenderIdValidation("VERYLONGBRANDNAME", "MASKING").valid).toBe(false);
    expect(basicSenderIdValidation("8809612345678", "NON_MASKING").valid).toBe(true);
  });
});
