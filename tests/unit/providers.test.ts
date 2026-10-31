import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { MockSmsProvider } from "@/services/sms/mock-provider";
import { HttpSmsProvider } from "@/services/sms/http-provider";
import { AutomasSmsProvider } from "@/services/sms/automas-provider";
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

describe("Automas provider", () => {
  afterEach(() => vi.unstubAllGlobals());
  const p = new AutomasSmsProvider({ apiKey: "k" });
  const reply = (entry: unknown) => vi.fn(async () => new Response(JSON.stringify({ response: [entry] }), { status: 200 }));
  const bangla: SendSmsInput = { ...input("+8801712345678"), message: "পরীক্ষা", encoding: "UCS2" };

  it("form-posts the documented parameters without a leading plus and keeps the key out of the URL", async () => {
    const fetchMock = reply({ status: 0, id: 296334, msisdn: "8801712345678" });
    vi.stubGlobal("fetch", fetchMock);
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: true, providerMessageId: "296334" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.automas.com.bd/smsapiv3");
    const form = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(form)).toEqual({ apikey: "k", sender: "BRAND", msisdn: "8801712345678", smstext: "Hello" });
  });

  it("sets the Unicode flags for Bangla and sends the text intact", async () => {
    const fetchMock = reply({ status: 0, id: 1 });
    vi.stubGlobal("fetch", fetchMock);
    await p.sendSms(bangla);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    expect(form.get("smstext")).toBe("পরীক্ষা");
    expect(form.get("type")).toBeNull();
    expect(form.get("smsformat")).toBe("8");
  });

  it("marks multi-part messages as long", async () => {
    const sentForm = async (message: string, encoding: SendSmsInput["encoding"]) => {
      const fetchMock = reply({ status: 0, id: 1 });
      vi.stubGlobal("fetch", fetchMock);
      await p.sendSms({ ...input("+8801712345678"), message, encoding });
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      return new URLSearchParams(String(init.body));
    };
    expect((await sentForm("a".repeat(160), "GSM7")).get("type")).toBeNull();
    expect((await sentForm("a".repeat(161), "GSM7")).get("type")).toBe("long");
    const longBangla = await sentForm("প".repeat(71), "UCS2");
    expect(longBangla.get("type")).toBe("long");
    expect(longBangla.get("smsformat")).toBe("8");
  });

  it("does not mistake a failed send for success, even though it carries an id (recorded live)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"response":[{"status":106,"id":165804,"msisdn":"8801700000000"}]}', { status: 200 })));
    expect(await p.sendSms(input("+8801700000000"))).toMatchObject({ ok: false, errorCode: "AUTOMAS_106", retryable: true });
  });

  it.each([101, 102, 105, 110, 111])("treats message fault %i as final", async (status) => {
    vi.stubGlobal("fetch", reply({ status, id: 1 }));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: false, errorCode: `AUTOMAS_${status}` });
  });

  it.each([103, 104, 106, 107, 108, 109, 1000, 2000, 2300, 2400, 3000, 3300, 4000])("retries account or upstream problem %i", async (status) => {
    vi.stubGlobal("fetch", reply({ status, id: 1 }));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: true });
  });

  it("accepts a numeric status sent as a string", async () => {
    vi.stubGlobal("fetch", reply({ status: "0", id: 7 }));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: true, providerMessageId: "7" });
  });

  it("does not retry undocumented statuses or unreadable replies, which could send twice", async () => {
    vi.stubGlobal("fetch", reply({ status: 9999, id: 1 }));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 200 })));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: false, errorCode: "INVALID_RESPONSE_200" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: false });
  });

  it("retries 5xx, 429 and network errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: true, errorCode: "HTTP_503" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connect failed"); }));
    expect(await p.sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: true, errorCode: "NETWORK_ERROR" });
  });

  it("keeps bulk results in input order", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const to = new URLSearchParams(String(init.body)).get("msisdn");
      return new Response(JSON.stringify({ response: [{ status: 0, id: to }] }), { status: 200 });
    }));
    const numbers = Array.from({ length: 25 }, (_, i) => `+88017123456${String(i).padStart(2, "0")}`);
    const results = await p.sendBulkSms(numbers.map(input));
    expect(results.map((r) => r.ok && r.providerMessageId)).toEqual(numbers.map((n) => n.slice(1)));
  });

  it("reports missing configuration without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await new AutomasSmsProvider({ apiKey: "" }).sendSms(input("+8801712345678"))).toMatchObject({ ok: false, retryable: true, errorCode: "PROVIDER_NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("declares no delivery reports and refuses all webhooks", async () => {
    expect(p.hasDeliveryReports).toBe(false);
    expect(await p.verifyWebhook()).toBe(false);
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
