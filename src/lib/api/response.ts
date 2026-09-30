import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, isAppError, type ErrorCode } from "@/lib/errors";

/**
 * Consistent JSON envelope for every /api/v1 response.
 *   success: { success: true, data, meta }
 *   error:   { success: false, error: { code, message, details? }, meta }
 */
export interface ApiMeta {
  requestId: string;
  [key: string]: unknown;
}

export function ok<T>(data: T, meta: ApiMeta, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json({ success: true, data, meta }, { status: init?.status ?? 200, headers: init?.headers });
}

export function fail(code: ErrorCode, message: string, meta: ApiMeta, status: number, details?: unknown, headers?: Record<string, string>) {
  return NextResponse.json(
    { success: false, error: { code, message, ...(details ? { details } : {}) }, meta },
    { status, headers },
  );
}

export function zodDetails(err: ZodError) {
  return {
    fields: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

/** Maps any thrown error to an API response. Unknown errors never leak internals. */
export function errorResponse(err: unknown, meta: ApiMeta, headers?: Record<string, string>) {
  if (err instanceof ZodError) return fail("VALIDATION_ERROR", "The request is invalid.", meta, 422, zodDetails(err), headers);
  if (isAppError(err)) {
    const e = err as AppError;
    return fail(e.code, e.expose ? e.message : "The request could not be completed.", meta, e.status, e.details, headers);
  }
  return fail("INTERNAL_ERROR", "Something went wrong on our side. Retry, and contact support if it persists.", meta, 500, undefined, headers);
}
