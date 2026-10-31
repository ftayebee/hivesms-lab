import type { SenderType, SmsEncoding, SmsType } from "@/generated/prisma/enums";

/**
 * Contract every upstream SMS provider adapter implements. The rest of the platform only talks
 * to this interface, so switching providers means writing one adapter (see
 * docs/05-integrations.md), not changing the send pipeline.
 */
export interface SendSmsInput {
  /** Our message id; pass through as the provider's client reference when supported. */
  reference: string;
  /** E.164, e.g. +8801712345678 */
  to: string;
  message: string;
  senderId: string;
  senderType: SenderType;
  smsType: SmsType;
  encoding: SmsEncoding;
}

export type SendSmsResult =
  | { ok: true; providerMessageId: string; raw?: unknown }
  | {
      ok: false;
      /** true = temporary problem (timeout, 5xx, throttling): the pipeline retries with backoff. */
      retryable: boolean;
      errorCode: string;
      errorMessage: string;
      raw?: unknown;
    };

export type ProviderDeliveryStatus = "SUBMITTED" | "DELIVERED" | "FAILED" | "EXPIRED" | "REJECTED" | "UNKNOWN";

export interface DeliveryStatusResult {
  status: ProviderDeliveryStatus;
  providerStatus?: string;
  errorCode?: string;
  description?: string;
  occurredAt?: Date;
}

export interface ProviderBalance {
  amount: number;
  currency: string;
  /** Some providers report balance in SMS units rather than money. */
  unit: "currency" | "sms";
}

export interface SenderIdValidation {
  valid: boolean;
  reason?: string;
}

export interface WebhookRequest {
  headers: Headers;
  rawBody: string;
  query: URLSearchParams;
}

export interface ParsedDeliveryEvent {
  providerMessageId: string;
  status: ProviderDeliveryStatus;
  providerStatus?: string;
  errorCode?: string;
  description?: string;
  occurredAt: Date;
  /** Stable identifier for deduplication of replayed webhooks. */
  eventKey: string;
  raw: unknown;
}

export interface InboundSms {
  from: string;
  to: string;
  text: string;
  receivedAt: Date;
  eventKey: string;
}

export interface SmsProvider {
  readonly key: string;
  readonly displayName: string;
  /** False for adapters that are scaffolding and need provider-specific review. */
  readonly verified: boolean;
  /** False when the provider offers neither webhooks nor a status API: messages then stay SUBMITTED ("Sent"). */
  readonly hasDeliveryReports?: boolean;

  sendSms(input: SendSmsInput): Promise<SendSmsResult>;
  sendBulkSms(inputs: SendSmsInput[]): Promise<SendSmsResult[]>;
  getDeliveryStatus(providerMessageId: string): Promise<DeliveryStatusResult>;
  getBalance(): Promise<ProviderBalance | null>;
  validateSenderId(senderId: string, type: SenderType): Promise<SenderIdValidation>;

  /** Verify authenticity of an inbound webhook (signature / shared secret). */
  verifyWebhook(req: WebhookRequest): Promise<boolean>;
  parseDeliveryWebhook(req: WebhookRequest): Promise<ParsedDeliveryEvent[]>;
  parseInboundWebhook?(req: WebhookRequest): Promise<InboundSms[]>;
}

/** Common sender ID format checks (provider/operator rules may be stricter). */
export function basicSenderIdValidation(senderId: string, type: SenderType): SenderIdValidation {
  if (type === "MASKING") {
    if (!/^[A-Za-z0-9 .\-&]{3,11}$/.test(senderId)) {
      return { valid: false, reason: "Masking sender IDs are usually 3 to 11 letters, digits or spaces." };
    }
    if (!/[A-Za-z]/.test(senderId)) return { valid: false, reason: "A masking sender ID must contain letters." };
    return { valid: true };
  }
  if (!/^\+?\d{6,15}$/.test(senderId)) return { valid: false, reason: "Non-masking sender IDs are phone numbers." };
  return { valid: true };
}
