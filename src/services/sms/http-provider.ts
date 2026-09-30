import { hmacSha256, safeEqual } from "@/lib/crypto";
import { logger, maskPhone } from "@/lib/logger";
import { mapGenericDeliveryStatus } from "./mock-provider";
import {
  basicSenderIdValidation,
  type DeliveryStatusResult,
  type InboundSms,
  type ParsedDeliveryEvent,
  type SendSmsInput,
  type SendSmsResult,
  type SmsProvider,
  type WebhookRequest,
} from "./types";

/**
 * Generic HTTP gateway adapter.
 *
 * ⚠ UNVERIFIED SCAFFOLDING. Many Bangladeshi gateways expose a similar "POST api_key, to, msg,
 * sender_id → JSON" API, but parameter names, success flags, number formats and delivery
 * report formats differ per provider. Before production use:
 *   1. Read your provider's API documentation.
 *   2. Configure the parameter mapping in Admin → Settings → SMS provider (or subclass this).
 *   3. Adjust `interpretSendResponse` and `parseDeliveryWebhook` to the provider's formats.
 *   4. Send test messages to your own numbers and verify delivery reports end to end.
 * `verified` is false until someone has done this for a specific provider.
 */
export interface HttpProviderConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret: string;
  mapping?: Partial<Record<"to" | "message" | "senderId" | "apiKey" | "apiSecret" | "type", string>>;
  timeoutMs?: number;
}

export class HttpSmsProvider implements SmsProvider {
  readonly key = "http";
  readonly displayName = "Generic HTTP gateway (unverified)";
  readonly verified = false;

  constructor(private readonly cfg: HttpProviderConfig) {}

  private param(name: keyof NonNullable<HttpProviderConfig["mapping"]>, fallback: string) {
    return this.cfg.mapping?.[name] || fallback;
  }

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    if (!this.cfg.url || !this.cfg.apiKey) {
      return { ok: false, retryable: false, errorCode: "PROVIDER_NOT_CONFIGURED", errorMessage: "SMS provider URL or API key is not configured." };
    }
    const form = new URLSearchParams();
    form.set(this.param("apiKey", "api_key"), this.cfg.apiKey);
    if (this.cfg.apiSecret) form.set(this.param("apiSecret", "api_secret"), this.cfg.apiSecret);
    form.set(this.param("to", "to"), input.to.replace(/^\+/, "")); // most BD gateways expect 8801XXXXXXXXX
    form.set(this.param("message", "msg"), input.message);
    form.set(this.param("senderId", "sender_id"), input.senderId);
    form.set(this.param("type", "type"), input.encoding === "UCS2" ? "unicode" : "text");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 15_000);
    try {
      const res = await fetch(this.cfg.url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form,
        signal: controller.signal,
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* non-JSON response */
      }
      logger.info({ provider: this.key, status: res.status, to: maskPhone(input.to) }, "provider send response");
      if (res.status >= 500 || res.status === 429) {
        return { ok: false, retryable: true, errorCode: `HTTP_${res.status}`, errorMessage: "Provider temporarily unavailable.", raw: json ?? text.slice(0, 500) };
      }
      return this.interpretSendResponse(res.status, json, text);
    } catch (err) {
      const aborted = (err as Error).name === "AbortError";
      return {
        ok: false,
        retryable: true,
        errorCode: aborted ? "TIMEOUT" : "NETWORK_ERROR",
        errorMessage: aborted ? "Provider request timed out." : "Could not reach the SMS provider.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Adjust for your provider. Accepts common success shapes: {error:0}, {success:true}, {status:"success"}. */
  protected interpretSendResponse(status: number, json: unknown, text: string): SendSmsResult {
    const body = (json ?? {}) as Record<string, unknown>;
    const data = (body.data ?? {}) as Record<string, unknown>;
    const success =
      status >= 200 &&
      status < 300 &&
      (body.error === 0 || body.success === true || ["success", "ok", "sent", "queued"].includes(String(body.status).toLowerCase()));
    const id = data.request_id ?? data.message_id ?? body.message_id ?? body.id ?? body.request_id;
    if (success && id) return { ok: true, providerMessageId: String(id), raw: body };
    return {
      ok: false,
      retryable: false,
      errorCode: String(body.error ?? body.code ?? `HTTP_${status}`),
      errorMessage: String(body.msg ?? body.message ?? text.slice(0, 200) ?? "Provider rejected the message."),
      raw: json ?? text.slice(0, 500),
    };
  }

  async sendBulkSms(inputs: SendSmsInput[]): Promise<SendSmsResult[]> {
    // Sequential with small concurrency to respect provider throughput limits.
    const results: SendSmsResult[] = [];
    const concurrency = 5;
    for (let i = 0; i < inputs.length; i += concurrency) {
      results.push(...(await Promise.all(inputs.slice(i, i + concurrency).map((x) => this.sendSms(x)))));
    }
    return results;
  }

  async getDeliveryStatus(): Promise<DeliveryStatusResult> {
    // Most gateways expose a report endpoint; implement for your provider. Until then the
    // platform relies on delivery webhooks.
    return { status: "UNKNOWN" };
  }

  async getBalance() {
    return null;
  }

  async validateSenderId(senderId: string, type: "MASKING" | "NON_MASKING") {
    return basicSenderIdValidation(senderId, type);
  }

  /** Expects X-Signature = hex HMAC-SHA256(webhookSecret, rawBody), or ?token=<webhookSecret>. */
  async verifyWebhook(req: WebhookRequest): Promise<boolean> {
    if (!this.cfg.webhookSecret) return false; // never accept unsigned webhooks from a real provider
    const sig = req.headers.get("x-signature");
    if (sig) return safeEqual(sig, hmacSha256(this.cfg.webhookSecret, req.rawBody));
    const token = req.query.get("token");
    return token ? safeEqual(token, this.cfg.webhookSecret) : false;
  }

  async parseDeliveryWebhook(req: WebhookRequest): Promise<ParsedDeliveryEvent[]> {
    const ct = req.headers.get("content-type") ?? "";
    const items: Record<string, string>[] = [];
    if (ct.includes("application/json")) {
      const body = JSON.parse(req.rawBody) as Record<string, unknown>;
      const list = Array.isArray(body) ? body : Array.isArray(body.events) ? body.events : [body];
      items.push(...(list as Record<string, string>[]));
    } else {
      items.push(Object.fromEntries(new URLSearchParams(req.rawBody)));
    }
    return items
      .map((e): ParsedDeliveryEvent | null => {
        const id = e.message_id ?? e.request_id ?? e.id;
        const status = e.status ?? e.dlr_status ?? "";
        if (!id) return null;
        const occurredAt = e.timestamp ? new Date(e.timestamp) : new Date();
        return {
          providerMessageId: String(id),
          status: mapGenericDeliveryStatus(String(status)),
          providerStatus: String(status),
          errorCode: e.error_code,
          description: e.description,
          occurredAt: isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
          eventKey: `http:${id}:${status}:${e.timestamp ?? ""}`,
          raw: e,
        };
      })
      .filter((x): x is ParsedDeliveryEvent => x !== null);
  }

  async parseInboundWebhook(req: WebhookRequest): Promise<InboundSms[]> {
    const body = (req.headers.get("content-type") ?? "").includes("json")
      ? (JSON.parse(req.rawBody) as Record<string, string>)
      : Object.fromEntries(new URLSearchParams(req.rawBody));
    if (!body.from || !body.text) return [];
    return [
      {
        from: body.from,
        to: body.to ?? "",
        text: body.text,
        receivedAt: new Date(),
        eventKey: `http-inbound:${body.id ?? `${body.from}:${body.timestamp ?? Date.now()}`}`,
      },
    ];
  }
}
