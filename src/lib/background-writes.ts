import { logger } from "@/lib/logger";

/**
 * Best-effort writes that must not delay the response (API request logs,
 * last-used timestamps). They are tracked so tests and graceful shutdown can
 * wait for them instead of racing them.
 */
const pending = new Set<Promise<unknown>>();

export function trackWrite(write: Promise<unknown>, label: string) {
  const p = write.catch((err) => logger.error({ err }, `background write failed: ${label}`)).finally(() => pending.delete(p));
  pending.add(p);
}

export async function drainWrites() {
  while (pending.size > 0) await Promise.allSettled([...pending]);
}
