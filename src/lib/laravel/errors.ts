/**
 * Errors from the Laravel API (no server-only imports, so action-result.ts and tests can use it).
 * The HTTP client lives in src/lib/laravel-api.ts.
 */

export type LaravelErrorKind =
  | "unauthenticated" // 401: session missing/expired → sign in again
  | "forbidden" // 403: missing permission / no organization / suspended / email not verified
  | "not_found" // 404 (also another organization's id)
  | "validation" // 422
  | "conflict" // 409
  | "insufficient_balance" // 402
  | "rate_limited" // 429
  | "unavailable" // 503 / 502 / 504 / network / timeout
  | "server"; // 500 and anything unexpected

export const KIND_BY_STATUS: Record<number, LaravelErrorKind> = {
  401: "unauthenticated",
  402: "insufficient_balance",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limited",
  502: "unavailable",
  503: "unavailable",
  504: "unavailable",
};

export const GENERIC_MESSAGES: Partial<Record<LaravelErrorKind, string>> = {
  unavailable: "The service is temporarily unavailable. Please try again shortly.",
  server: "Something went wrong. Please try again.",
};

/** An error answered (or not answered) by the Laravel API, with the envelope's code and details. */
export class LaravelApiError extends Error {
  constructor(
    readonly kind: LaravelErrorKind,
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "LaravelApiError";
  }

  /**
   * Field errors in the server-action shape. Laravel's validation contract is
   * `details.fields: [{path, message}]`; business errors tied to one input use `details.field`.
   */
  get fieldErrors(): Record<string, string[]> | undefined {
    const fields = this.details?.fields;
    if (Array.isArray(fields)) {
      const out: Record<string, string[]> = {};
      for (const f of fields as Array<{ path?: unknown; message?: unknown }>) {
        const key = typeof f.path === "string" && f.path ? f.path : "_";
        (out[key] ??= []).push(String(f.message ?? "Invalid value."));
      }
      return out;
    }
    const field = this.details?.field;
    return typeof field === "string" ? { [field]: [this.message] } : undefined;
  }

  /**
   * Message safe to show to an end user. The client already replaced anything that is not written
   * for users (500s, gateway/timeout errors) with a generic text; 500s are always generic here.
   */
  get userMessage(): string {
    return this.kind === "server" ? (GENERIC_MESSAGES.server ?? this.message) : this.message;
  }
}

export function isLaravelApiError(err: unknown): err is LaravelApiError {
  return err instanceof LaravelApiError;
}
