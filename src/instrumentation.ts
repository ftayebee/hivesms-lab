import type { Instrumentation } from "next";

/**
 * Server start-up hook.
 *
 * WORKER_IN_PROCESS=true runs the background worker loop inside the web server process. That is
 * convenient for local development and small single-instance deployments. For production with
 * more than one web instance, leave it off and run `npm run worker` as a separate process.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.WORKER_IN_PROCESS !== "true") return;
  const g = globalThis as unknown as { __smsflowWorker?: boolean };
  if (g.__smsflowWorker) return; // survive dev hot reloads
  g.__smsflowWorker = true;

  const { runWorkerTick, runHousekeeping } = await import("@/services/messaging/worker");
  const { logger } = await import("@/lib/logger");
  const interval = Number(process.env.WORKER_INTERVAL_MS ?? 2000);
  logger.info({ interval }, "in-process worker enabled");
  const loop = async () => {
    try {
      await runWorkerTick();
      await runHousekeeping();
    } catch (err) {
      logger.error({ err }, "in-process worker tick failed");
    } finally {
      setTimeout(loop, interval);
    }
  };
  setTimeout(loop, 3000);
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const { logger } = await import("@/lib/logger");
  logger.error(
    {
      err: { message: err instanceof Error ? err.message : String(err), digest: typeof err === "object" && err && "digest" in err ? String((err as { digest: unknown }).digest) : undefined },
      path: request.path,
      method: request.method,
      routeType: context.routeType,
    },
    "request error",
  );
};
