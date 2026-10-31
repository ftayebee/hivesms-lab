import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isProduction } from "@/config/env";
import { platformCan, type Permission, type PlatformPermission, hasPermission } from "@/lib/auth/permissions";
import { laravel, isLaravelApiError } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { getLaravelMe, sessionFromMe, tenantFromMe, type LaravelIssuedSession } from "@/lib/laravel/session";
import type { TenantContext } from "@/lib/auth/context";
import {
  buildTenantContext,
  createSession,
  defaultOrganizationFor,
  resolveSessionToken,
  revokeSession,
  type ResolvedSession,
} from "@/lib/auth/session-store";

/**
 * Next.js side of sessions: cookie handling plus cached per-request helpers for pages,
 * layouts and server actions.
 *
 * With LARAVEL_FEATURES containing `auth`, sessions are created, resolved and revoked by the
 * Laravel API (same `sessions` table and token format, so existing cookies stay valid in both
 * directions); otherwise by Prisma (session-store.ts). The cookie itself never changes: httpOnly,
 * SameSite=Lax, Secure + __Host- prefix in production, on the Next.js origin only.
 */
export const SESSION_COOKIE = isProduction() ? "__Host-sf_session" : "sf_session";

export async function getRequestMeta() {
  const h = await headers();
  // Behind a trusted reverse proxy, the first X-Forwarded-For entry is the client.
  // Configure your proxy to overwrite (not append to) this header.
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}

async function setSessionCookie(token: string, expiresAt: Date, persistent: boolean) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    ...(persistent ? { expires: expiresAt } : {}),
  });
}

/** Prisma path: creates the session row and sets the cookie. */
export async function startSession(userId: string, organizationId: string | null, remember: boolean) {
  const meta = await getRequestMeta();
  const { token, session, persistent } = await createSession({ userId, organizationId, remember, ...meta });
  await setSessionCookie(token, session.expiresAt, persistent);
  return session;
}

/** Laravel path: stores the token Laravel issued (login, register, invitation signup) in the cookie. */
export async function startLaravelSession(issued: Pick<LaravelIssuedSession, "token" | "expiresAt" | "persistent">) {
  await setSessionCookie(issued.token, new Date(issued.expiresAt), issued.persistent);
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    if (laravelEnabled("auth")) {
      // Laravel revokes the row and writes the auth.logout audit entry. An already expired or
      // revoked session (401) is fine: the cookie is removed either way.
      await laravel.post("auth/logout").catch((err) => {
        if (!isLaravelApiError(err) || err.kind !== "unauthenticated") throw err;
      });
    } else {
      const resolved = await resolveSessionToken(token);
      if (resolved) await revokeSession(resolved.sessionId);
    }
  }
  // Same attributes as when it was set: browsers ignore changes to a __Host- cookie without Secure.
  jar.set(SESSION_COOKIE, "", { httpOnly: true, secure: isProduction(), sameSite: "lax", path: "/", maxAge: 0 });
}

/** Current session for this request (cached), or null. */
export const getSession = cache(async (): Promise<ResolvedSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  if (laravelEnabled("auth")) {
    const me = await getLaravelMe();
    return me ? sessionFromMe(me) : null;
  }
  return resolveSessionToken(token);
});

export async function requireSession(): Promise<ResolvedSession> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Tenant context for the dashboard. Redirects to login when signed out, and falls back to
 * another organization when the active one is no longer accessible.
 */
export const getTenantContext = cache(async (): Promise<TenantContext | null> => {
  const session = await getSession();
  if (!session) return null;
  const meta = await getRequestMeta();
  if (laravelEnabled("auth")) {
    // Laravel already fell back to another active membership (and saved it) when needed.
    const me = await getLaravelMe();
    return me ? tenantFromMe(me, meta) : null;
  }
  let orgId = session.activeOrganizationId;
  let ctx = orgId ? await buildTenantContext(session.user.id, orgId, meta) : null;
  if (!ctx) {
    orgId = await defaultOrganizationFor(session.user.id);
    if (!orgId) return null;
    ctx = await buildTenantContext(session.user.id, orgId, meta);
    if (ctx) await db.session.update({ where: { id: session.sessionId }, data: { activeOrganizationId: orgId } });
  }
  return ctx;
});

export async function requireTenant(): Promise<{ session: ResolvedSession; ctx: TenantContext }> {
  const session = await requireSession();
  const ctx = await getTenantContext();
  if (!ctx) redirect("/onboarding");
  return { session, ctx };
}

/** For pages: returns ctx if permitted; otherwise null so the page can render PermissionDenied. */
export async function tenantWithPermission(permission: Permission | Permission[]) {
  const { session, ctx } = await requireTenant();
  return { session, ctx, allowed: hasPermission(ctx.permissions, permission) };
}

export async function requirePlatform(permission: PlatformPermission = "admin:access") {
  const session = await requireSession();
  if (!platformCan(session.user.platformRole, permission)) {
    // Staff without this specific permission go back to the admin home; customers to their dashboard.
    redirect(platformCan(session.user.platformRole, "admin:access") && permission !== "admin:access" ? "/admin?denied=1" : "/dashboard");
  }
  return session;
}

export async function switchOrganization(organizationId: string) {
  if (laravelEnabled("auth")) {
    try {
      await laravel.post("auth/switch-organization", { organizationId });
      return true;
    } catch (err) {
      if (isLaravelApiError(err) && (err.kind === "forbidden" || err.kind === "validation" || err.kind === "not_found")) return false;
      if (isLaravelApiError(err) && err.kind === "unauthenticated") redirect("/login");
      throw err;
    }
  }
  const session = await requireSession();
  const ctx = await buildTenantContext(session.user.id, organizationId);
  if (!ctx) return false;
  await db.session.update({ where: { id: session.sessionId }, data: { activeOrganizationId: organizationId } });
  return true;
}
