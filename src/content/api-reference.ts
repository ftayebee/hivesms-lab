import { ErrorCodes, type ErrorCode } from "@/lib/errors";

/** Human documentation for every public error code (HTTP status comes from lib/errors). */
const descriptions: Record<ErrorCode, string> = {
  INVALID_REQUEST: "The request is malformed (invalid JSON, body too large, bad header).",
  VALIDATION_ERROR: "One or more fields are invalid. See error.details.fields.",
  UNAUTHORIZED: "Not signed in (dashboard endpoints).",
  INVALID_API_KEY: "The API key is missing, malformed, revoked or expired.",
  FORBIDDEN: "Authenticated but not allowed (IP not allowlisted, account suspended, missing permission).",
  INSUFFICIENT_SCOPE: "The API key does not have the scope this endpoint requires.",
  ACCOUNT_SUSPENDED: "The organization is suspended. Contact support.",
  EMAIL_NOT_VERIFIED: "Verify the account email before using this feature.",
  NOT_FOUND: "The resource does not exist or belongs to another account.",
  CONFLICT: "The request conflicts with the current state (e.g. a duplicate, or a request with the same Idempotency-Key still in progress).",
  IDEMPOTENCY_CONFLICT: "The Idempotency-Key was already used with a different request body.",
  RATE_LIMITED: "Too many requests. Wait for the time in the Retry-After header.",
  INSUFFICIENT_BALANCE: "Wallet balance is lower than the cost of the request.",
  INVALID_RECIPIENT: "The number is not a valid Bangladesh mobile number, or is blocked.",
  SENDER_ID_NOT_APPROVED: "The sender_id is not approved for your account.",
  CONTENT_BLOCKED: "The message matched a content rule or needs review.",
  MESSAGE_TOO_LONG: "The message exceeds the maximum number of segments.",
  RECIPIENT_SUPPRESSED: "The recipient opted out of promotional messages.",
  QUIET_HOURS: "Promotional messages cannot be sent at this time (Asia/Dhaka).",
  DAILY_LIMIT_EXCEEDED: "The request would exceed your daily sending limit.",
  MONTHLY_LIMIT_EXCEEDED: "The request would exceed your monthly sending limit.",
  PAYMENT_FAILED: "A payment could not be completed or verified.",
  PROVIDER_ERROR: "The upstream SMS provider returned an error.",
  PROVIDER_NOT_CONFIGURED: "No SMS provider is configured for this platform.",
  FEATURE_DISABLED: "This feature is not enabled.",
  INTERNAL_ERROR: "Unexpected server error. Safe to retry with the same Idempotency-Key.",
};

export const errorCodeList = (Object.keys(ErrorCodes) as ErrorCode[]).map((code) => ({ code, status: ErrorCodes[code], description: descriptions[code] }));

export interface EndpointDoc {
  method: "GET" | "POST";
  path: string;
  summary: string;
  scope?: string;
  anchor: string;
}

export const publicEndpoints: EndpointDoc[] = [
  { method: "POST", path: "/api/v1/sms/send", summary: "Send one SMS", scope: "sms:send", anchor: "send-sms" },
  { method: "POST", path: "/api/v1/sms/bulk", summary: "Send up to 1,000 SMS in one request", scope: "sms:send", anchor: "bulk-sms" },
  { method: "POST", path: "/api/v1/sms/estimate", summary: "Calculate segments and cost without sending", scope: "sms:send", anchor: "estimate" },
  { method: "GET", path: "/api/v1/messages/{id}", summary: "Get a message and its delivery events", scope: "messages:read", anchor: "get-message" },
  { method: "GET", path: "/api/v1/messages", summary: "List messages with filters", scope: "messages:read", anchor: "list-messages" },
  { method: "GET", path: "/api/v1/balance", summary: "Wallet balance and your rates", scope: "balance:read", anchor: "balance" },
  { method: "GET", path: "/api/v1/sender-ids", summary: "List your sender IDs and their status", scope: "sender_ids:read", anchor: "sender-ids" },
];
