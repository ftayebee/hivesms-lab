import { randomAlphanumeric } from "@/lib/crypto";
import { hmacSha256, safeEqual } from "@/lib/crypto";
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
 * Local simulator. NO MESSAGE LEAVES THE MACHINE.
 *
 * Deterministic outcomes by the recipient's last digits, so tests and demos are repeatable:
 *   ...0000  rejected at submission (e.g. operator block)
 *   ...8888  temporary provider error on every attempt (exercises retries, then fails)
 *   ...9999  accepted, then reported FAILED ("handset unreachable")
 *   anything else: accepted, then DELIVERED a few seconds later
 *
 * Delivery results are produced by the worker polling getDeliveryStatus() (the same code path
 * used for real providers that lack webhooks), or by POSTing to the webhook endpoint with the
 * documented mock payload.
 */
const DELIVERY_DELAY_MS = 3_000;

function outcomeFor(to: string): "reject" | "transient" | "fail" | "deliver" {
  if (to.endsWith("0000")) return "reject";
  if (to.endsWith("8888")) return "transient";
  if (to.endsWith("9999")) return "fail";
  return "deliver";
}

export class MockSmsProvider implements SmsProvider {
  readonly key = "mock";
  readonly displayName = "Mock provider (local simulation)";
  readonly verified = true;

  constructor(private readonly webhookSecret: string = "") {}

  async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
    const outcome = outcomeFor(input.to);
    if (outcome === "reject") {
      return { ok: false, retryable: false, errorCode: "MOCK_REJECTED", errorMessage: "Recipient rejected by operator (simulated)." };
    }
    if (outcome === "transient") {
      return { ok: false, retryable: true, errorCode: "MOCK_TEMPORARY", errorMessage: "Provider temporarily unavailable (simulated)." };
    }
    const flag = outcome === "fail" ? "f" : "d";
    // id encodes the simulated result and submission time: mock_<d|f>_<ts36>_<rand>
    const providerMessageId = `mock_${flag}_${Date.now().toString(36)}_${randomAlphanumeric(10)}`;
    return { ok: true, providerMessageId };
  }

  async sendBulkSms(inputs: SendSmsInput[]): Promise<SendSmsResult[]> {
    return Promise.all(inputs.map((i) => this.sendSms(i)));
  }

  async getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult> {
    const m = /^mock_([df])_([0-9a-z]+)_/.exec(providerMessageId);
    if (!m) return { status: "UNKNOWN" };
    const submittedAt = parseInt(m[2], 36);
    if (Date.now() - submittedAt < DELIVERY_DELAY_MS) return { status: "SUBMITTED", providerStatus: "ENROUTE" };
    const occurredAt = new Date(submittedAt + DELIVERY_DELAY_MS);
    return m[1] === "d"
      ? { status: "DELIVERED", providerStatus: "DELIVRD", occurredAt, description: "Delivered (simulated)" }
      : {
          status: "FAILED",
          providerStatus: "UNDELIV",
          errorCode: "MOCK_UNREACHABLE",
          description: "Handset unreachable (simulated)",
          occurredAt,
        };
  }

  async getBalance() {
    return { amount: 1_000_000, currency: "SMS", unit: "sms" as const };
  }

  async validateSenderId(senderId: string, type: "MASKING" | "NON_MASKING") {
    return basicSenderIdValidation(senderId, type);
  }

  /**
   * Mock webhook contract (also the recommended contract for custom adapters):
   * header X-Signature: hex HMAC-SHA256(webhookSecret, rawBody)
   */
  async verifyWebhook(req: WebhookRequest): Promise<boolean> {
    if (!this.webhookSecret) return process.env.NODE_ENV !== "production";
    const sig = req.headers.get("x-signature") ?? "";
    return safeEqual(sig, hmacSha256(this.webhookSecret, req.rawBody));
  }

  /** Payload: { "events": [{ "message_id", "status", "timestamp", "error_code"?, "description"? }] } */
  async parseDeliveryWebhook(req: WebhookRequest): Promise<ParsedDeliveryEvent[]> {
    const body = JSON.parse(req.rawBody) as {
      events?: { message_id: string; status: string; timestamp?: string; error_code?: string; description?: string }[];
    };
    return (body.events ?? []).map((e) => {
      const status = mapStatus(e.status);
      const occurredAt = e.timestamp ? new Date(e.timestamp) : new Date();
      return {
        providerMessageId: e.message_id,
        status,
        providerStatus: e.status,
        errorCode: e.error_code,
        description: e.description,
        occurredAt,
        eventKey: `mock:${e.message_id}:${e.status}:${occurredAt.toISOString()}`,
        raw: e,
      };
    });
  }

  /** Payload: { "messages": [{ "id", "from", "to", "text", "timestamp" }] } */
  async parseInboundWebhook(req: WebhookRequest): Promise<InboundSms[]> {
    const body = JSON.parse(req.rawBody) as { messages?: { id: string; from: string; to: string; text: string; timestamp?: string }[] };
    return (body.messages ?? []).map((m) => ({
      from: m.from,
      to: m.to,
      text: m.text,
      receivedAt: m.timestamp ? new Date(m.timestamp) : new Date(),
      eventKey: `mock-inbound:${m.id}`,
    }));
  }
}

function mapStatus(s: string): ParsedDeliveryEvent["status"] {
  switch (s.toUpperCase()) {
    case "DELIVERED":
    case "DELIVRD":
      return "DELIVERED";
    case "FAILED":
    case "UNDELIV":
    case "UNDELIVERED":
      return "FAILED";
    case "EXPIRED":
      return "EXPIRED";
    case "REJECTED":
      return "REJECTED";
    case "SUBMITTED":
    case "ENROUTE":
    case "ACCEPTED":
      return "SUBMITTED";
    default:
      return "UNKNOWN";
  }
}

export { mapStatus as mapGenericDeliveryStatus };
