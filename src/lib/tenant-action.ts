import "server-only";
import { actionError, type ActionResult } from "@/lib/action-result";
import { requireTenant } from "@/lib/auth/session";
import { requirePermission, type TenantContext } from "@/lib/auth/context";
import type { Permission } from "@/lib/auth/permissions";
import type { ResolvedSession } from "@/lib/auth/session-store";
import { AppError } from "@/lib/errors";

/**
 * Runs a dashboard server action in the caller's tenant context with a permission check and
 * uniform error handling. Tenant id always comes from the session, never from the client.
 */
export async function tenantAction<T>(
  permission: Permission | Permission[] | null,
  fn: (ctx: TenantContext, session: ResolvedSession) => Promise<ActionResult<T> | void>,
  opts: { requireVerifiedEmail?: boolean; raw?: Record<string, unknown> } = {},
): Promise<ActionResult<T>> {
  try {
    const { ctx, session } = await requireTenant();
    if (permission) requirePermission(ctx, permission);
    if (opts.requireVerifiedEmail && !session.user.emailVerifiedAt) {
      throw new AppError("EMAIL_NOT_VERIFIED", "Verify your email address before sending messages. Check your inbox or resend the link from the banner.");
    }
    const r = await fn(ctx, session);
    return r ?? { ok: true };
  } catch (err) {
    return actionError(err, opts.raw);
  }
}
