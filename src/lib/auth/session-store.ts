import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import type { SessionUser, TenantContext } from "@/lib/auth/context";

/**
 * Database side of sessions (no Next.js imports, so tests and the worker can use it).
 * Only the SHA-256 of the session token is stored.
 */
export const SESSION_TTL_DAYS = 7;
export const SESSION_REMEMBER_TTL_DAYS = 30;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function createSession(input: {
  userId: string;
  organizationId: string | null;
  remember: boolean;
  ip?: string | null;
  userAgent?: string | null;
}) {
  const token = randomToken(32);
  const days = input.remember ? SESSION_REMEMBER_TTL_DAYS : SESSION_TTL_DAYS;
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  const session = await db.session.create({
    data: {
      tokenHash: sha256(token),
      userId: input.userId,
      activeOrganizationId: input.organizationId,
      ipAddress: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      expiresAt,
    },
  });
  return { token, session, persistent: input.remember };
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
  activeOrganizationId: string | null;
  expiresAt: Date;
}

export async function resolveSessionToken(token: string): Promise<ResolvedSession | null> {
  if (!token || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          platformRole: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          locale: true,
          status: true,
          deletedAt: true,
          passwordChangedAt: true,
        },
      },
    },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now || session.user.status !== "ACTIVE" || session.user.deletedAt) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  // Sessions created before a password change are invalid.
  if (session.user.passwordChangedAt && session.createdAt < session.user.passwordChangedAt) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  const { id, email, name, phone, platformRole, emailVerifiedAt, phoneVerifiedAt, locale } = session.user;
  const user = { id, email, name, phone, platformRole, emailVerifiedAt, phoneVerifiedAt, locale };
  return { sessionId: session.id, user, activeOrganizationId: session.activeOrganizationId, expiresAt: session.expiresAt };
}

export async function revokeSession(sessionId: string) {
  await db.session.deleteMany({ where: { id: sessionId } });
}

export async function revokeAllUserSessions(userId: string, exceptSessionId?: string) {
  await db.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}

/**
 * Loads the membership for (user, organization) and builds the tenant context.
 * Returns null when the user is not an active member (e.g. removed from the team).
 */
export async function buildTenantContext(
  userId: string,
  organizationId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<TenantContext | null> {
  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: {
      organization: { select: { status: true, deletedAt: true } },
      role: { select: { key: true, permissions: { select: { permission: { select: { key: true } } } } } },
    },
  });
  if (!membership || membership.status !== "ACTIVE" || membership.organization.deletedAt) return null;
  return {
    organizationId,
    organizationStatus: membership.organization.status,
    userId,
    apiKeyId: null,
    roleKey: membership.role.key,
    permissions: membership.role.permissions.map((rp) => rp.permission.key),
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

/** Picks the organization to activate for a user: the requested one if valid, else the first. */
export async function defaultOrganizationFor(userId: string): Promise<string | null> {
  const m = await db.organizationMember.findFirst({
    where: { userId, status: "ACTIVE", organization: { deletedAt: null } },
    orderBy: { joinedAt: "asc" },
    select: { organizationId: true },
  });
  return m?.organizationId ?? null;
}
