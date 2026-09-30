import type { NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { runHousekeeping, runWorkerTick } from "@/services/messaging/worker";

/**
 * POST /api/internal/worker/tick: runs one worker cycle. For platforms without long-running
 * processes, call this from an external scheduler every minute with
 * "Authorization: Bearer <CRON_SECRET>".
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!secret || !safeEqual(token, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const summary = await runWorkerTick({ maxBatches: 20 });
  await runHousekeeping();
  return Response.json({ ok: true, ...summary });
}
