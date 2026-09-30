import { ZodError } from "zod";
import { isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Uniform return type for server actions, so every form shows field errors inline and a
 * summary message, without throwing across the network boundary.
 */
export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]>; code?: string; values?: Record<string, string> };

export const initialActionState: ActionResult<never> | null = null;

const SECRET_FIELD = /pass|token|secret|code|otp/i;

/** Non-secret submitted values, echoed back so the form can be re-filled after an error. */
export function echoValues(raw: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([k, v]) => !SECRET_FIELD.test(k) && (typeof v === "string" || typeof v === "boolean"))
      .map(([k, v]) => [k, String(v).slice(0, 5000)]),
  );
}

export function actionError(err: unknown, raw?: Record<string, unknown>): ActionResult<never> {
  const values = raw ? echoValues(raw) : undefined;
  const result = actionErrorInner(err);
  return values && !result.ok ? { ...result, values } : result;
}

function actionErrorInner(err: unknown): ActionResult<never> {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
  }
  if (isAppError(err)) {
    const field = typeof err.details?.field === "string" ? err.details.field : undefined;
    return { ok: false, error: err.message, code: err.code, ...(field ? { fieldErrors: { [field]: [err.message] } } : {}) };
  }
  // Next.js uses thrown errors for redirect()/notFound(); let those propagate.
  if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
  logger.error({ err }, "server action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Converts FormData to a plain object; repeated keys become arrays; checkboxes "on" → true. */
export function formToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    const value = v === "on" ? true : v;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], value);
    else out[k] = value;
  }
  return out;
}
