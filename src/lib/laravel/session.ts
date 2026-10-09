import "server-only";
import { cache } from "react";
import type { OrganizationStatus, PlatformRole } from "@/generated/prisma/enums";
import type { TenantContext } from "@/lib/auth/context";
import type { ResolvedSession } from "@/lib/auth/session-store";
import { laravel, isLaravelApiError } from "@/lib/laravel-api";
import { date } from "@/lib/laravel/convert";

/**
 * Session and tenant context from Laravel (`GET /auth/me`), used when LARAVEL_FEATURES has `auth`.
 * Same `sessions` rows and the same opaque token as before: the httpOnly cookie on the Next.js
 * origin holds the token, Laravel receives it as a Bearer token (server-to-server only).
 */

export interface LaravelMe {
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    platformRole: PlatformRole;
    status: string;
    locale: string;
    emailVerifiedAt: string | null;
    phoneVerifiedAt: string | null;
  };
  session: { id: string; expiresAt: string };
  organization: {
    id: string;
    name: string;
    slug: string;
    status: OrganizationStatus;
    suspendedReason: string | null;
    role: string;
    permissions: string[];
    plan: { id: string; name: string } | null;
    /** Rounded to 2 dp; null without billing:read. */
    balance: string | null;
    unreadNotifications: number;
  } | null;
  organizations: Array<{ id: string; name: string; slug: string; status: OrganizationStatus; role: string; roleName: string }>;
  platformPermissions: string[];
  features: { phoneVerification: boolean };
}

/** The signed-in user's /auth/me for this request (cached per request), or null when signed out. */
export const getLaravelMe = cache(async (): Promise<LaravelMe | null> => {
  try {
    return (await laravel.get<LaravelMe>("auth/me")).data;
  } catch (err) {
    if (isLaravelApiError(err) && err.kind === "unauthenticated") return null;
    throw err;
  }
});

export function sessionFromMe(me: LaravelMe): ResolvedSession {
  const u = me.user;
  return {
    sessionId: me.session.id,
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone,
      platformRole: u.platformRole,
      emailVerifiedAt: date(u.emailVerifiedAt),
      phoneVerifiedAt: date(u.phoneVerifiedAt),
      locale: u.locale,
    },
    activeOrganizationId: me.organization?.id ?? null,
    expiresAt: date(me.session.expiresAt),
  };
}

export function tenantFromMe(me: LaravelMe, meta: { ip?: string | null; userAgent?: string | null } = {}): TenantContext | null {
  const org = me.organization;
  if (!org) return null;
  return {
    organizationId: org.id,
    organizationStatus: org.status,
    userId: me.user.id,
    apiKeyId: null,
    roleKey: org.role,
    permissions: org.permissions,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

/** Answer of POST /auth/login, /auth/register and /auth/invitations/signup. */
export interface LaravelIssuedSession {
  token: string;
  expiresAt: string;
  persistent: boolean;
  organizationId: string | null;
  isStaff: boolean;
  user: { id: string; name: string; email: string; emailVerifiedAt: string | null };
}
