/**
 * Background worker: scheduled campaigns, send queue, retries, delivery polling, customer
 * webhooks and housekeeping.
 *
 *   npm run worker            (development, with .env)
 *   node --conditions=react-server --import tsx scripts/worker.ts   (what the npm script runs)
 *
 * Run one or more instances alongside the web app. All steps claim work atomically, so extra
 * instances add throughput without double-sending.
 */
import "dotenv/config";
import { logger } from "@/lib/logger";
import { runHousekeeping, runWorkerTick } from "@/services/messaging/worker";
import { laravelEnabled } from "@/lib/laravel/flags";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 2000);
let stopping = false;

async function loop() {
  if (laravelEnabled("worker")) {
    // LARAVEL_FEATURES `worker`: Laravel's scheduler (php artisan schedule:run → sms:work) is the only background processor.
    logger.info("worker not started: background processing is handled by the Laravel scheduler");
    process.exit(0);
  }
  logger.info({ intervalMs: INTERVAL_MS, provider: process.env.SMS_PROVIDER ?? "mock" }, "worker started");
  while (!stopping) {
    try {
      await runWorkerTick();
      await runHousekeeping();
    } catch (err) {
      logger.error({ err }, "worker tick failed");
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  logger.info("worker stopped");
  process.exit(0);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    logger.info({ sig }, "worker stopping after current tick");
    stopping = true;
  });
}

loop();
