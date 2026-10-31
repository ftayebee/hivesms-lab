/** Classifies database errors without importing the Prisma client (safe to use anywhere server-side). */

function errorText(err: unknown) {
  const e = err as { message?: unknown; meta?: unknown } | null;
  let meta = "";
  try {
    meta = JSON.stringify(e?.meta ?? "");
  } catch {}
  return `${String(e?.message ?? err)} ${meta}`;
}

/**
 * Unique constraint violation (P2002). Returns the text naming the violated index
 * (e.g. "users_email_key") so callers can tell which field clashed, or null for other errors.
 */
export function uniqueViolationTarget(err: unknown): string | null {
  const e = err as { code?: string } | null;
  const text = errorText(err);
  return e?.code === "P2002" || /UniqueConstraintViolation|Duplicate entry|\b1062\b/.test(text) ? text : null;
}

/**
 * The database cannot serve requests: unreachable, wrong credentials, missing database or
 * tables (migrations not applied), or connection pool exhausted. Never shown to users verbatim.
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  const e = err as { code?: string; name?: string } | null;
  if (e?.name === "PrismaClientInitializationError") return true;
  if (e?.code && /^P10\d\d$|^P2021$|^P2024$/.test(e.code)) return true;
  return /DatabaseNotReachable|DatabaseDoesNotExist|AuthenticationFailed|TooManyConnections|SocketTimeout|ConnectionClosed|TableDoesNotExist|pool timeout|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(errorText(err));
}
