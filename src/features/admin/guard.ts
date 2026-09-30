import "server-only";
import { actionError, type ActionResult } from "@/lib/action-result";
import { getRequestMeta, getSession } from "@/lib/auth/session";
import { platformCan, type PlatformPermission } from "@/lib/auth/permissions";
import { AppError } from "@/lib/errors";

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
