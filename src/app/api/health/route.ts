import { db } from "@/lib/db";
import { laravelData } from "@/lib/laravel-api";
import { enabledLaravelFeatures, LARAVEL_FEATURES } from "@/lib/laravel/flags";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness probe for load balancers and monitoring. No secrets exposed.
 * Checks the Laravel API when any feature is switched to it, and the database only while some
 * feature still uses Prisma (with every feature on Laravel this app needs no database).
 */
export async function GET() {
  const started = Date.now();
  const switched = enabledLaravelFeatures();
  let api: "ok" | "unreachable" | undefined;
  if (switched.size > 0) {
    api = await laravelData<{ status: string; database: string }>("health", undefined, { auth: false, timeoutMs: 5_000 })
      .then((h) => (h.status === "ok" && h.database === "ok" ? ("ok" as const) : ("unreachable" as const)))
      .catch(() => "unreachable" as const);
    if (switched.size === LARAVEL_FEATURES.length) {
      return Response.json(
        { status: api === "ok" ? "ok" : "degraded", api, laravelFeatures: [...switched], latencyMs: Date.now() - started, time: new Date().toISOString() },
        { status: api === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }
  try {
    await db.$queryRaw`SELECT 1`;
    const queued = await db.message.count({ where: { status: "QUEUED", nextAttemptAt: { lte: new Date(Date.now() - 5 * 60_000) } } });
    return Response.json(
      {
        status: api === "unreachable" ? "degraded" : "ok",
        database: "ok",
        ...(api ? { api, laravelFeatures: [...switched] } : {}),
        stuckQueuedMessages: queued,
        latencyMs: Date.now() - started,
        time: new Date().toISOString(),
      },
      { status: api === "unreachable" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
