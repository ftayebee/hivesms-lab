import "server-only";
import type { z } from "zod";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date, pageMeta } from "@/lib/laravel/convert";
import type { organizationSchema, profileSchema } from "./service";

/**
 * Settings / profile / notifications through the Laravel API (LARAVEL_FEATURES: `profile`,
 * `notifications`). Same return shapes as the Prisma functions in ./service.ts.
 * The user and organization are always the session's (Laravel resolves them from the token).
 */

interface LaravelUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  locale: string;
  phoneVerifiedAt: string | null;
}

export async function getProfile() {
  const u = await laravelData<LaravelUser>("profile");
  return { name: u.name, email: u.email, phone: u.phone, locale: u.locale, phoneVerifiedAt: date(u.phoneVerifiedAt) };
}

interface LaravelOrganization {
  name: string;
  industry: string | null;
  website: string | null;
  address: string | null;
  billingEmail: string | null;
  taxId: string | null;
  dailySendLimit: number;
  monthlySendLimit: number;
  requireCampaignReview: boolean;
}

export async function getOrganization() {
  const o = await laravelData<LaravelOrganization>("app/organization");
  return {
    name: o.name,
    industry: o.industry,
    website: o.website,
    address: o.address,
    billingEmail: o.billingEmail,
    taxId: o.taxId,
    dailySendLimit: o.dailySendLimit,
    monthlySendLimit: o.monthlySendLimit,
    requireCampaignReview: o.requireCampaignReview,
  };
}

export async function updateProfile(input: z.infer<typeof profileSchema>) {
  await laravel.put("profile", input);
}

export async function updateOrganization(input: z.infer<typeof organizationSchema>) {
  await laravel.put("app/organization", input);
}

export async function listSessions() {
  const rows = await laravelData<Array<{ id: string; ipAddress: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string }>>("profile/sessions");
  return rows.map((r) => ({ id: r.id, ipAddress: r.ipAddress, userAgent: r.userAgent, createdAt: date(r.createdAt), lastSeenAt: date(r.lastSeenAt), expiresAt: date(r.expiresAt) }));
}

export async function revokeOwnSession(sessionId: string) {
  await laravel.delete(`profile/sessions/${encodeURIComponent(sessionId)}`);
}

export interface NotificationPref {
  type: string;
  label: string;
  inApp: boolean;
  email: boolean;
}

export async function getNotificationPrefs() {
  return laravelData<NotificationPref[]>("profile/notification-preferences");
}

export async function saveNotificationPrefs(prefs: { type: string; inApp: boolean; email: boolean }[]) {
  await laravel.put("profile/notification-preferences", { preferences: prefs });
}

export async function leaveOrganization() {
  await laravel.post("app/organization/leave");
}

interface LaravelNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(page: number) {
  const res = await laravel.get<LaravelNotification[]>("app/notifications", { page });
  const meta = pageMeta(res.meta, 30);
  const rows = res.data.map((n) => ({ ...n, readAt: date(n.readAt), createdAt: date(n.createdAt) }));
  return { rows, total: meta.total, unread: Number(res.meta.unread ?? 0) };
}

export async function markNotificationsRead(ids?: string[]) {
  await laravel.post("app/notifications/read", ids ? { ids } : {});
}
