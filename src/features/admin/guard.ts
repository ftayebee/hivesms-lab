import "server-only";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getRequestMeta, getSession } from "@/lib/auth/session";
import { platformCan, type PlatformPermission } from "@/lib/auth/permissions";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { verifyPassword } from "@/lib/auth/password";

export interface AdminContext {
  userId: string;
  name: string;
  role: "USER" | "SUPPORT" | "ADMIN" | "SUPER_ADMIN";
  ip: string | null;
  userAgent: string | null;
}

export async function requireAdminContext(permission: PlatformPermission): Promise<AdminContext> {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHORIZED", "Sign in to continue.");
  if (!platformCan(session.user.platformRole, permission)) throw new AppError("FORBIDDEN", "Your staff role does not allow this action.");
  const meta = await getRequestMeta();
  return { userId: session.user.id, name: session.user.name, role: session.user.platformRole, ip: meta.ip, userAgent: meta.userAgent };
}

/** Server-action wrapper for platform staff actions. */
export async function adminAction<T>(permission: PlatformPermission, fn: (admin: AdminContext) => Promise<ActionResult<T> | void>, raw?: Record<string, unknown>): Promise<ActionResult<T>> {
  try {
    const admin = await requireAdminContext(permission);
    return (await fn(admin)) ?? { ok: true };
  } catch (err) {
    return actionError(err, raw);
  }
}

export const adminActor = (a: AdminContext) => ({ type: "ADMIN" as const, userId: a.userId });

/**
 * Re-authentication for privileged actions on the Prisma path (the Laravel path does this in
 * PrivilegedActionGuard): the acting staff member confirms their current password. Five wrong
 * passwords within 15 minutes (counted from the audit log) lock privileged actions for that user.
 * The password is never logged or stored.
 */
export async function confirmAdminPassword(admin: AdminContext, password: string | undefined) {
  const failures = await db.auditLog.count({ where: { action: "admin.reauth.failed", actorUserId: admin.userId, createdAt: { gte: new Date(Date.now() - 15 * 60_000) } } });
  if (failures >= 5) throw new AppError("RATE_LIMITED", "Too many wrong passwords. Privileged actions are locked for 15 minutes.");
  const user = await db.user.findUnique({ where: { id: admin.userId }, select: { passwordHash: true } });
  if (!password || !user || !(await verifyPassword(user.passwordHash, password))) {
    await audit({ action: "admin.reauth.failed", actor: adminActor(admin), targetType: "user", targetId: admin.userId, ip: admin.ip, userAgent: admin.userAgent });
    throw new AppError("VALIDATION_ERROR", "Confirm with your current password.", { field: "currentPassword" });
  }
}
