import { logger, maskPhone } from "@/lib/logger";
import { calculateSegments } from "@/lib/sms-segments";
import {
  basicSenderIdValidation,
  type DeliveryStatusResult,
  type ParsedDeliveryEvent,
  type SendSmsInput,
  type SendSmsResult,
  type SmsProvider,
} from "./types";

/**
 * Automas Technologies (https://sms.automas.com.bd/api, read 2026-10-31).
 *
 * Uses the plain HTTP endpoint with a form POST, so the API key stays out of URLs and access logs.
 * It is the only endpoint documenting the Unicode flags, and it needs one request per message so
 * each message gets its own id. Response shapes below were recorded from the live API using a
 * deliberately invalid key:
 *   - smsapiv3 answers {"response":[{"status":106,"id":165804,"msisdn":"8801700000000"}]}
 *   - a failed send still carries an id, so only status 0 means accepted
 *   - smsapiv4 answers with a bare array, unlike its documented shape, so it is not used
 *
 * Not offered by the documented API, so not implemented:
 *   - delivery reports and inbound SMS: no webhook or status endpoint is documented
 *   - balance: the documented URL is the send endpoint, which answers [] without recipients
 *
 * `verified` stays false until the checklist in docs/05-integrations.md passes with a real key.
 */
const SEND_URL = "https://api.automas.com.bd/smsapiv3";
const UNICODE = "8";

/**
 * 10 concurrent requests with a 10 s timeout bound a batch of 100 to 100 s, inside the
 * dispatcher's 120 s lease, so a slow batch cannot be claimed and sent twice by the next tick.
 */
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 10;

const STATUS_MESSAGES: Record<number, string> = {
  101: "Invalid message length.",
  102: "Sender ID is not approved by the SMS provider.",
  103: "SMS provider authentication failed.",
  104: "SMS provider rejected the account as invalid.",
  105: "Invalid recipient number.",
  106: "Incorrect SMS provider API key.",
  107: "SMS provider account is suspended.",
  108: "This server's IP address is not allowed by the SMS provider.",
  109: "API access is not enabled on the SMS provider account.",
  110: "Recipient is on the Do Not Disturb list.",
  111: "Message contains a word blocked by the SMS provider.",
  1000: "SMS provider balance is insufficient.",
  2000: "Destination provider is unavailable.",
  2300: "Destination route issue.",
  2400: "API access is not enabled on the SMS provider account.",
  3000: "Destination provider is unavailable.",
  3300: "SMS provider system error.",
  4000: "Destination provider is unavailable.",
};

/**
 * Only faults of the message itself are final. Account problems (key, suspension, IP allowlist,
 * empty balance) are retried with backoff so that customers' messages survive until an operator
 * fixes the account; they are refunded if the retries run out.
 */
const PERMANENT_STATUSES = new Set([101, 102, 105, 110, 111]);

export interface AutomasProviderConfig {
  apiKey: string;
}

export class AutomasSmsProvider implements SmsProvider {
  readonly key = "automas";
  readonly displayName = "Automas Technologies";
  readonly verified = false;
  readonly hasDeliveryReports = false;

  constructor(private readonly cfg: AutomasProviderConfig) {}

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    if (!this.cfg.apiKey) {
      // An account problem like the ones below: customers' messages wait for an operator to fix it.
      return { ok: false, retryable: true, errorCode: "PROVIDER_NOT_CONFIGURED", errorMessage: "SMS provider API key is not configured." };
    }
    const form = new URLSearchParams({
      apikey: this.cfg.apiKey,
      sender: input.senderId.replace(/^\+/, ""),
      msisdn: input.to.replace(/^\+/, ""),
      smstext: input.message,
    });
    // Per the logged-in API page: type=long for multi-part, smsformat=8 for Unicode.
    if (calculateSegments(input.message).segments > 1) form.set("type", "long");
    if (input.encoding === "UCS2") form.set("smsformat", UNICODE);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(SEND_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form,
        signal: controller.signal,
      });
      const text = await res.text();
      logger.info({ provider: this.key, status: res.status, to: maskPhone(input.to) }, "provider send response");
      if (res.status >= 500 || res.status === 429) {
        return { ok: false, retryable: true, errorCode: `HTTP_${res.status}`, errorMessage: "Provider temporarily unavailable.", raw: text.slice(0, 500) };
      }
      return this.interpretSendResponse(res.status, text, input.reference);
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

  private interpretSendResponse(httpStatus: number, text: string, reference: string): SendSmsResult {
    let entry: { status?: unknown; id?: unknown } | undefined;
    try {
      entry = (JSON.parse(text) as { response?: { status?: unknown; id?: unknown }[] }).response?.[0];
    } catch {
      /* handled below */
    }
    const status = entry?.status === undefined || entry.status === "" ? NaN : Number(entry.status);
    // The message may or may not have gone out, and without a client reference a retry could send
    // it twice. Stop here rather than risk duplicates reaching the recipient.
    if (Number.isNaN(status)) {
      return { ok: false, retryable: false, errorCode: `INVALID_RESPONSE_${httpStatus}`, errorMessage: "Unexpected response from the SMS provider.", raw: text.slice(0, 500) };
    }
    if (status === 0) return { ok: true, providerMessageId: String(entry?.id ?? reference), raw: entry };
    return {
      ok: false,
      retryable: !PERMANENT_STATUSES.has(status) && status in STATUS_MESSAGES,
      errorCode: `AUTOMAS_${status}`,
      errorMessage: STATUS_MESSAGES[status] ?? "Provider rejected the message.",
      raw: entry,
    };
  }

  async sendBulkSms(inputs: SendSmsInput[]): Promise<SendSmsResult[]> {
    const results: SendSmsResult[] = [];
    for (let i = 0; i < inputs.length; i += CONCURRENCY) {
      results.push(...(await Promise.all(inputs.slice(i, i + CONCURRENCY).map((x) => this.sendSms(x)))));
    }
    return results;
  }

  async getDeliveryStatus(): Promise<DeliveryStatusResult> {
    return { status: "UNKNOWN" };
  }

  async getBalance() {
    return null;
  }

  async validateSenderId(senderId: string, type: "MASKING" | "NON_MASKING") {
    return basicSenderIdValidation(senderId, type);
  }

  /** Automas documents no webhooks, so nothing can be authenticated: every request is refused. */
  async verifyWebhook(): Promise<boolean> {
    return false;
  }

  async parseDeliveryWebhook(): Promise<ParsedDeliveryEvent[]> {
    return [];
  }
}
