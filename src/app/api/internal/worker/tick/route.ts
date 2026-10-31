import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { laravelEnabled } from "@/lib/laravel/flags";
import { runHousekeeping, runWorkerTick } from "@/services/messaging/worker";

/**
 * POST /api/internal/worker/tick: runs one worker cycle. For platforms without long-running
 * processes (e.g. Hostinger Business web hosting), call this from a cron job every minute with
 * "Authorization: Bearer <CRON_SECRET>". WORKER_TICK_BUDGET_MS (default 45s) bounds the time
 * spent claiming new batches; overlapping ticks are safe because claims are atomic.
 *
 * GET is accepted too, for schedulers that only issue GET requests (Vercel Cron sends
 * "Authorization: Bearer <CRON_SECRET>" automatically when CRON_SECRET is set).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!secret || !safeEqual(token, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  // With LARAVEL_FEATURES `worker`, Laravel's scheduler (sms:work) is the only background processor.
  if (laravelEnabled("worker")) return Response.json({ ok: true, skipped: "handled by the Laravel scheduler" });
  const summary = await runWorkerTick({ maxBatches: 20, budgetMs: Number(process.env.WORKER_TICK_BUDGET_MS ?? 45_000) });
  await runHousekeeping();
  return Response.json({ ok: true, ...summary });
}

export const GET = POST;
