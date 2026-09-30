import { after } from "next/server";
import { logger } from "@/lib/logger";

/**
 * Schedules work after the response is sent (next/server `after`). Outside a Next.js request
 * scope (tests, scripts) it runs the task immediately in the background instead.
 */
export function runAfter(task: () => Promise<unknown>) {
  // Tests drive background work (dispatch, worker ticks) explicitly for determinism.
  if (process.env.NODE_ENV === "test") return;
  const safe = () => task().catch((err) => logger.error({ err }, "background task failed"));
  try {
    after(safe);
  } catch {
    void safe();
  }
}
