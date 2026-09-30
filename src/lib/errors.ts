/**
 * Application error codes. These are part of the public API contract (see docs → Error codes),
 * so only add new codes; never rename existing ones.
 */
export const ErrorCodes = {
  INVALID_REQUEST: 400,
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  INVALID_API_KEY: 401,
  FORBIDDEN: 403,
  INSUFFICIENT_SCOPE: 403,
  ACCOUNT_SUSPENDED: 403,
  EMAIL_NOT_VERIFIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  RATE_LIMITED: 429,
  INSUFFICIENT_BALANCE: 402,
  INVALID_RECIPIENT: 422,
  SENDER_ID_NOT_APPROVED: 422,
  CONTENT_BLOCKED: 422,
  MESSAGE_TOO_LONG: 422,
  RECIPIENT_SUPPRESSED: 422,
  QUIET_HOURS: 422,
  DAILY_LIMIT_EXCEEDED: 429,
  MONTHLY_LIMIT_EXCEEDED: 429,
  PAYMENT_FAILED: 402,
  PROVIDER_ERROR: 502,
  PROVIDER_NOT_CONFIGURED: 503,
  FEATURE_DISABLED: 403,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  /** Errors marked expose=false never show their message to clients. */
  readonly expose: boolean;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, expose = true) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ErrorCodes[code];
    this.details = details;
    this.expose = expose;
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (message = "You do not have permission to perform this action.") =>
  new AppError("FORBIDDEN", message);
