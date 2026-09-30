import type { OrganizationStatus, PlatformRole } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { hasPermission, type Permission } from "@/lib/auth/permissions";

/**
 * The identity every tenant-scoped service call runs under. Services take this as their first
 * argument and scope every query with `organizationId`. Built from a session (dashboard) or
 * from an API key (public API); never from client input.
 */
export interface TenantContext {
  organizationId: string;
  organizationStatus: OrganizationStatus;
  /** Set for dashboard users. */
  userId: string | null;
  /** Set for API-key requests. */
  apiKeyId: string | null;
  roleKey: string | null;
  permissions: readonly string[];
  ip?: string | null;
  userAgent?: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  platformRole: PlatformRole;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  locale: string;
}

export function requirePermission(ctx: TenantContext, permission: Permission | Permission[]) {
  if (!hasPermission(ctx.permissions, permission)) {
    throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
  }
}

export function can(ctx: Pick<TenantContext, "permissions">, permission: Permission | Permission[]) {
  return hasPermission(ctx.permissions, permission);
}

export function assertOrgActive(ctx: TenantContext) {
  if (ctx.organizationStatus !== "ACTIVE") {
    throw new AppError("ACCOUNT_SUSPENDED", "This account is suspended. Contact support to restore access.");
  }
}

export function actorOf(ctx: TenantContext) {
  return ctx.apiKeyId
    ? ({ type: "API_KEY", apiKeyId: ctx.apiKeyId } as const)
    : ({ type: "USER", userId: ctx.userId! } as const);
}
