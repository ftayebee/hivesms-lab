import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { logger } from "@/lib/logger";

export type AuditActor =
  | { type: "USER"; userId: string }
  | { type: "ADMIN"; userId: string }
  | { type: "API_KEY"; apiKeyId: string }
  | { type: "SYSTEM" };

export interface AuditEntry {
  action: string;
  actor: AuditActor;
  organizationId?: string | null;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an audit log entry. Pass `tx` to make the audit record part of the same transaction
 * as the change it describes. Never put secrets or full message bodies in metadata.
 */
export async function audit(entry: AuditEntry, tx?: Tx) {
  const client = tx ?? db;
  const data: Prisma.AuditLogUncheckedCreateInput = {
    action: entry.action,
    actorType: entry.actor.type,
    actorUserId: entry.actor.type === "USER" || entry.actor.type === "ADMIN" ? entry.actor.userId : null,
    actorApiKeyId: entry.actor.type === "API_KEY" ? entry.actor.apiKeyId : null,
    organizationId: entry.organizationId ?? null,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ipAddress: entry.ip ?? null,
    userAgent: entry.userAgent?.slice(0, 500) ?? null,
    metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
  };
  try {
    await client.auditLog.create({ data });
  } catch (err) {
    // Inside a transaction the error must propagate (the change should not commit unaudited).
    if (tx) throw err;
    logger.error({ err, action: entry.action }, "failed to write audit log");
  }
  logger.info(
    { audit: entry.action, actor: entry.actor.type, org: entry.organizationId, target: entry.targetId },
    "audit",
  );
}
