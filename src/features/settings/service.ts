import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, requirePermission, type TenantContext } from "@/lib/auth/context";
import { normalizeBdPhone } from "@/lib/phone";
import { revokeSession } from "@/lib/auth/session-store";
import { NOTIFICATION_TYPES, type NotificationType } from "@/services/notify";
import { laravelEnabled } from "@/lib/laravel/flags";
import * as viaLaravel from "./laravel";

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  phone: z
    .string()
    .trim()
    .optional()
    .transform((v, ctx) => {
      if (!v) return null;
      const n = normalizeBdPhone(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "Enter a valid Bangladesh mobile number." });
        return z.NEVER;
      }
      return n;
    }),
  locale: z.enum(["en", "bn"]).default("en"),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Enter the organization name.").max(120),
  industry: z.string().trim().max(60).optional().transform((v) => v || null),
  website: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null)
    .refine((v) => !v || /^https?:\/\/[^\s]+\.[^\s]+/.test(v), "Enter a full URL starting with https://"),
  address: z.string().trim().max(300).optional().transform((v) => v || null),
  billingEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email address.").nullable()),
  taxId: z.string().trim().max(30).optional().transform((v) => v || null),
});

/** Settings page: the signed-in user's profile. */
export async function getProfile(userId: string) {
  if (laravelEnabled("profile")) return viaLaravel.getProfile();
  return db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, phone: true, locale: true, phoneVerifiedAt: true } });
}

/** Settings page: the active organization's editable details and limits. */
export async function getOrganizationSettings(ctx: TenantContext) {
  if (laravelEnabled("profile")) return viaLaravel.getOrganization();
  return db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: { name: true, industry: true, website: true, address: true, billingEmail: true, taxId: true, dailySendLimit: true, monthlySendLimit: true, requireCampaignReview: true },
  });
}

export async function updateProfile(userId: string, input: z.infer<typeof profileSchema>) {
  if (laravelEnabled("profile")) return viaLaravel.updateProfile(input);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (input.phone && input.phone !== user.phone) {
    const taken = await db.user.findFirst({ where: { phone: input.phone, id: { not: userId } } });
    if (taken) throw new AppError("CONFLICT", "This mobile number is used by another account.", { field: "phone" });
  }
  await db.user.update({
    where: { id: userId },
    data: { name: input.name, phone: input.phone, locale: input.locale, ...(input.phone !== user.phone ? { phoneVerifiedAt: null } : {}) },
  });
  await audit({ action: "user.profile_update", actor: { type: "USER", userId }, metadata: { phoneChanged: input.phone !== user.phone } });
}

export async function updateOrganization(ctx: TenantContext, input: z.infer<typeof organizationSchema>) {
  requirePermission(ctx, "settings:manage");
  if (laravelEnabled("profile")) return viaLaravel.updateOrganization(input);
  await db.organization.update({ where: { id: ctx.organizationId }, data: input });
  await audit({ action: "organization.update", actor: actorOf(ctx), organizationId: ctx.organizationId, metadata: { fields: Object.keys(input) } });
}

export async function listSessions(userId: string) {
  if (laravelEnabled("profile")) return viaLaravel.listSessions();
  return db.session.findMany({ where: { userId, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" }, select: { id: true, ipAddress: true, userAgent: true, createdAt: true, lastSeenAt: true, expiresAt: true } });
}

export async function revokeOwnSession(userId: string, sessionId: string, currentSessionId: string) {
  if (sessionId === currentSessionId) throw new AppError("VALIDATION_ERROR", "Use Sign out to end your current session.");
  if (laravelEnabled("profile")) return viaLaravel.revokeOwnSession(sessionId);
  const s = await db.session.findFirst({ where: { id: sessionId, userId } });
  if (!s) throw new AppError("NOT_FOUND", "Session not found.");
  await revokeSession(sessionId);
  await audit({ action: "auth.session_revoke", actor: { type: "USER", userId }, metadata: { sessionId } });
}

export async function getNotificationPrefs(userId: string) {
  if (laravelEnabled("profile")) return viaLaravel.getNotificationPrefs();
  const rows = await db.notificationPreference.findMany({ where: { userId } });
  const by = new Map(rows.map((r) => [r.type, r]));
  return (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((type) => ({
    type,
    label: NOTIFICATION_TYPES[type].label,
    inApp: by.get(type)?.inApp ?? true,
    email: by.get(type)?.email ?? NOTIFICATION_TYPES[type].email,
  }));
}

export async function saveNotificationPrefs(userId: string, prefs: { type: string; inApp: boolean; email: boolean }[]) {
  if (laravelEnabled("profile")) return viaLaravel.saveNotificationPrefs(prefs);
  const valid = prefs.filter((p) => p.type in NOTIFICATION_TYPES);
  await db.$transaction(
    valid.map((p) =>
      db.notificationPreference.upsert({
        where: { userId_type: { userId, type: p.type } },
        create: { userId, type: p.type, inApp: p.inApp, email: p.email },
        update: { inApp: p.inApp, email: p.email },
      }),
    ),
  );
}

export async function leaveOrganization(ctx: TenantContext) {
  if (!ctx.userId) throw new AppError("FORBIDDEN", "Not allowed.");
  if (laravelEnabled("profile")) return viaLaravel.leaveOrganization();
  if (ctx.roleKey === "OWNER") {
    const owners = await db.organizationMember.count({ where: { organizationId: ctx.organizationId, status: "ACTIVE", role: { key: "OWNER" } } });
    if (owners <= 1) throw new AppError("CONFLICT", "You are the only owner. Make someone else an owner before leaving.");
  }
  await db.organizationMember.delete({ where: { organizationId_userId: { organizationId: ctx.organizationId, userId: ctx.userId } } });
  await audit({ action: "team.leave", actor: actorOf(ctx), organizationId: ctx.organizationId });
}

// ─── Notifications inbox ───

export const NOTIFICATIONS_PAGE = 30;

export async function listNotifications(ctx: TenantContext, page: number) {
  if (laravelEnabled("notifications")) return viaLaravel.listNotifications(page);
  const where = { userId: ctx.userId!, organizationId: ctx.organizationId };
  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * NOTIFICATIONS_PAGE, take: NOTIFICATIONS_PAGE }),
    db.notification.count({ where }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ]);
  return { rows, total, unread };
}

export async function markNotificationsRead(ctx: TenantContext, ids?: string[]) {
  if (laravelEnabled("notifications")) return viaLaravel.markNotificationsRead(ids);
  await db.notification.updateMany({
    where: { userId: ctx.userId!, organizationId: ctx.organizationId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
}
