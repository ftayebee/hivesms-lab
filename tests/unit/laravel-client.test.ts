import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { laravelBaseUrl, laravelFetch, laravelActionError } from "@/lib/laravel-api";
import { LaravelApiError } from "@/lib/laravel/errors";
import { enabledLaravelFeatures, laravelEnabled, LARAVEL_FEATURES } from "@/lib/laravel/flags";
import { date, dec, pageMeta, reviveDates } from "@/lib/laravel/convert";
import { actionError } from "@/lib/action-result";
import { rangeToQuery, parseRange } from "@/features/reports/range";

/**
 * The Laravel API client and cutover plumbing (docs/14-frontend-laravel-cutover-audit.md).
 * fetch is stubbed; no network, no database.
 */

const envelope = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("LARAVEL_API_URL normalisation", () => {
  it("accepts the origin, /api or the full /api/v1 base, with or without a trailing slash", () => {
    expect(laravelBaseUrl("https://smsbackend.hivelabsbd.com")).toBe("https://smsbackend.hivelabsbd.com/api/v1");
    expect(laravelBaseUrl("https://smsbackend.hivelabsbd.com/")).toBe("https://smsbackend.hivelabsbd.com/api/v1");
    expect(laravelBaseUrl("https://smsbackend.hivelabsbd.com/api")).toBe("https://smsbackend.hivelabsbd.com/api/v1");
    expect(laravelBaseUrl("https://smsbackend.hivelabsbd.com/api/v1")).toBe("https://smsbackend.hivelabsbd.com/api/v1");
    expect(laravelBaseUrl(" https://smsbackend.hivelabsbd.com/api/v1/ ")).toBe("https://smsbackend.hivelabsbd.com/api/v1");
    expect(laravelBaseUrl("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000/api/v1");
  });

  it("fails as 'unavailable' (never a crash) when not configured", () => {
    expect(() => laravelBaseUrl("")).toThrow(LaravelApiError);
    try {
      laravelBaseUrl(undefined);
    } catch (err) {
      expect((err as LaravelApiError).kind).toBe("unavailable");
      expect((err as LaravelApiError).code).toBe("LARAVEL_API_URL_MISSING");
    }
  });
});

describe("feature flags", () => {
  const saved = process.env.LARAVEL_FEATURES;
  afterEach(() => {
    process.env.LARAVEL_FEATURES = saved;
  });

  it("defaults to Prisma for every feature", () => {
    delete process.env.LARAVEL_FEATURES;
    expect(enabledLaravelFeatures().size).toBe(0);
    expect(laravelEnabled("auth")).toBe(false);
  });

  it("parses lists, `all` and exclusions; ignores unknown names", () => {
    process.env.LARAVEL_FEATURES = "auth, profile ,bogus";
    expect([...enabledLaravelFeatures()].sort()).toEqual(["auth", "profile"]);
    process.env.LARAVEL_FEATURES = "all,-payments,-admin";
    expect(laravelEnabled("payments")).toBe(false);
    expect(laravelEnabled("admin")).toBe(false);
    expect(laravelEnabled("contacts")).toBe(true);
    expect(enabledLaravelFeatures().size).toBe(LARAVEL_FEATURES.length - 2);
  });
});

describe("laravelFetch", () => {
  beforeEach(() => {
    process.env.LARAVEL_API_URL = "https://api.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unwraps the envelope and sends JSON with Accept, Bearer token and Idempotency-Key", async () => {
    const fetchMock = vi.fn(async () => envelope(200, { success: true, data: { id: 1 }, meta: { requestId: "req_1", page: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await laravelFetch<{ id: number }>("app/contacts", { method: "POST", body: { a: 1 }, token: "tok", idempotencyKey: "k1", query: { page: 2, skip: undefined, tags: ["a", "b"] } });
    expect(r.data).toEqual({ id: 1 });
    expect(r.meta.requestId).toBe("req_1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/v1/app/contacts?page=2&tags=a&tags=b");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer tok");
    expect(h["Idempotency-Key"]).toBe("k1");
    expect(h["Content-Type"]).toBe("application/json");
    expect(h.Accept).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it.each([
    [401, "unauthenticated", "UNAUTHORIZED", "Sign in to continue."],
    [403, "forbidden", "FORBIDDEN", "You do not have permission to perform this action."],
    [404, "not_found", "NOT_FOUND", "Contact not found."],
    [409, "conflict", "CONFLICT", "A contact with this number already exists."],
    [402, "insufficient_balance", "INSUFFICIENT_BALANCE", "Add balance and try again."],
    [429, "rate_limited", "RATE_LIMITED", "Too many requests."],
  ])("maps HTTP %i to kind %s keeping Laravel's message and request id", async (status, kind, code, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => envelope(status, { success: false, error: { code, message }, meta: { requestId: `req_${status}` } }, { "retry-after": "30" })));
    const err = (await laravelFetch("x", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as LaravelApiError;
    expect(err).toBeInstanceOf(LaravelApiError);
    expect(err.kind).toBe(kind);
    expect(err.code).toBe(code);
    expect(err.message).toBe(message);
    expect(err.userMessage).toBe(message);
    expect(err.requestId).toBe(`req_${status}`);
    expect(err.retryAfterSeconds).toBe(30);
  });

  it("keeps the validation contract details.fields[{path,message}] as field errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        envelope(422, {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "The request is invalid.", details: { fields: [{ path: "phone", message: "Enter a valid Bangladesh mobile number." }, { path: "phone", message: "Second." }, { path: "email", message: "Enter a valid email address." }] } },
          meta: { requestId: "req_v" },
        }),
      ),
    );
    const err = (await laravelFetch("x", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as LaravelApiError;
    expect(err.kind).toBe("validation");
    expect(err.fieldErrors).toEqual({ phone: ["Enter a valid Bangladesh mobile number.", "Second."], email: ["Enter a valid email address."] });
    expect(laravelActionError(err)).toMatchObject({ ok: false, code: "VALIDATION_ERROR", fieldErrors: { email: ["Enter a valid email address."] } });
    // The shared server-action error path maps it the same way as a Zod error.
    expect(actionError(err, { email: "x", password: "secret" })).toMatchObject({ ok: false, error: "Please fix the highlighted fields.", values: { email: "x" } });
    expect((actionError(err, { password: "secret" }) as { values?: Record<string, string> }).values).toEqual({});
  });

  it("maps a single-field business error (details.field) to that field", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => envelope(409, { success: false, error: { code: "CONFLICT", message: "A contact with this number already exists.", details: { field: "phone" } } })));
    const err = await laravelFetch("x", { method: "POST", body: {}, token: "t" }).catch((e) => e);
    expect(actionError(err)).toEqual({ ok: false, error: "A contact with this number already exists.", code: "CONFLICT", fieldErrors: { phone: ["A contact with this number already exists."] } });
  });

  it("never shows a 500's message, SQL or stack; keeps the request id for the logs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => envelope(500, { success: false, error: { code: "INTERNAL_ERROR", message: "SQLSTATE[42S02]: Base table not found: /var/www/app.php" }, meta: { requestId: "req_500" } })));
    const err = (await laravelFetch("x", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as LaravelApiError;
    expect(err.kind).toBe("server");
    expect(err.message).toBe("Something went wrong. Please try again.");
    expect(err.requestId).toBe("req_500");
    const r = actionError(err);
    expect(r).toMatchObject({ ok: false, error: "Something went wrong. Please try again." });
    expect(JSON.stringify(r)).not.toMatch(/SQLSTATE|\/var\/www/);
  });

  it("retries GETs on 503 and network errors, never writes", async () => {
    const getMock = vi
      .fn()
      .mockResolvedValueOnce(envelope(503, { success: false, error: { code: "INTERNAL_ERROR", message: "x" } }))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(envelope(200, { success: true, data: "ok", meta: {} }));
    vi.stubGlobal("fetch", getMock);
    expect((await laravelFetch("x", { token: "t" })).data).toBe("ok");
    expect(getMock).toHaveBeenCalledTimes(3);

    const postMock = vi.fn(async () => envelope(503, { success: false, error: { code: "INTERNAL_ERROR", message: "x" } }));
    vi.stubGlobal("fetch", postMock);
    const err = (await laravelFetch("x", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as LaravelApiError;
    expect(err.kind).toBe("unavailable");
    expect(err.message).toBe("The service is temporarily unavailable. Please try again shortly.");
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the text of business 5xx codes (provider errors) but not of infrastructure failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => envelope(502, { success: false, error: { code: "PROVIDER_ERROR", message: "The SMS provider rejected the message. Try again." } })));
    const err = (await laravelFetch("x", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as LaravelApiError;
    expect(err.kind).toBe("unavailable");
    expect(err.userMessage).toBe("The SMS provider rejected the message. Try again.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    const err2 = (await laravelFetch("x", { method: "POST", body: {}, token: "t" }).catch((e) => e)) as LaravelApiError;
    expect(err2.userMessage).toBe("The service is temporarily unavailable. Please try again shortly.");
  });

  it("reports an unreachable API as 'unavailable' after the retries", async () => {
    const m = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", m);
    const err = (await laravelFetch("x", { token: "t" }).catch((e) => e)) as LaravelApiError;
    expect(err.kind).toBe("unavailable");
    expect(err.code).toBe("UPSTREAM_UNREACHABLE");
    expect(m).toHaveBeenCalledTimes(3);
  });
});

describe("response converters", () => {
  it("turns money strings into exact decimals and ISO strings into dates", () => {
    expect(dec("12.3400").toFixed(2)).toBe("12.34");
    expect(dec(null).toString()).toBe("0");
    expect(dec("0.1").plus(dec("0.2")).toString()).toBe("0.3");
    expect(date("2026-10-07T06:00:00.000Z")?.toISOString()).toBe("2026-10-07T06:00:00.000Z");
    expect(date(null)).toBeNull();
  });

  it("revives only date-named keys, never free text that looks like a timestamp", () => {
    const r = reviveDates({ createdAt: "2026-10-07T06:00:00.000Z", body: "2026-10-07T06:00:00.000Z", nested: [{ deliveredAt: "2026-10-07T06:00:00.000Z" }] });
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.body).toBe("2026-10-07T06:00:00.000Z");
    expect(r.nested[0].deliveredAt).toBeInstanceOf(Date);
  });

  it("reads list meta", () => {
    expect(pageMeta({ page: 2, pageSize: 25, total: 51, totalPages: 3 })).toEqual({ page: 2, pageSize: 25, total: 51, totalPages: 3 });
    expect(pageMeta({ total: 51 }, 25)).toEqual({ page: 1, pageSize: 25, total: 51, totalPages: 3 });
  });

  it("sends date ranges to Laravel as Asia/Dhaka calendar days", () => {
    expect(rangeToQuery(parseRange({ range: "7d" }))).toEqual({ range: "7d" });
    expect(rangeToQuery(parseRange({ range: "custom", from: "2026-09-01", to: "2026-09-30" }))).toEqual({ range: "custom", from: "2026-09-01", to: "2026-09-30" });
  });
});
