import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Liveness + database readiness probe for load balancers and monitoring. No secrets exposed. */
export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const queued = await db.message.count({ where: { status: "QUEUED", nextAttemptAt: { lte: new Date(Date.now() - 5 * 60_000) } } });
    return Response.json(
      { status: "ok", database: "ok", stuckQueuedMessages: queued, latencyMs: Date.now() - started, time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
