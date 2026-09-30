"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { LOCALE_COOKIE } from "@/i18n";
import { leaveOrganization, markNotificationsRead, organizationSchema, profileSchema, revokeOwnSession, saveNotificationPrefs, updateOrganization, updateProfile } from "./service";

export async function updateProfileAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    null,
    async (_ctx, session) => {
      const input = profileSchema.parse(raw);
      await updateProfile(session.user.id, input);
      (await cookies()).set(LOCALE_COOKIE, input.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
      revalidatePath("/dashboard", "layout");
      return { ok: true, message: "Profile saved." };
    },
    { raw },
  );
}

export async function updateOrganizationAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "settings:manage",
    async (ctx) => {
      await updateOrganization(ctx, organizationSchema.parse(raw));
      revalidatePath("/dashboard", "layout");
      return { ok: true, message: "Organization details saved." };
    },
    { raw },
  );
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  return tenantAction(null, async (_ctx, session) => {
    await revokeOwnSession(session.user.id, z.uuid().parse(sessionId), session.sessionId);
    revalidatePath("/dashboard/settings");
    return { ok: true, message: "Session signed out." };
  });
}

const prefsSchema = z.array(z.object({ type: z.string().max(40), inApp: z.boolean(), email: z.boolean() })).max(50);

export async function saveNotificationPrefsAction(prefs: { type: string; inApp: boolean; email: boolean }[]): Promise<ActionResult> {
  return tenantAction(null, async (_ctx, session) => {
    await saveNotificationPrefs(session.user.id, prefsSchema.parse(prefs));
    return { ok: true, message: "Notification preferences saved." };
  });
}

export async function markNotificationsReadAction(ids?: string[]): Promise<ActionResult> {
  return tenantAction(null, async (ctx) => {
    await markNotificationsRead(ctx, ids ? z.array(z.uuid()).max(100).parse(ids) : undefined);
    revalidatePath("/dashboard", "layout");
    return { ok: true };
  });
}

export async function leaveOrganizationAction(): Promise<ActionResult> {
  const r = await tenantAction(null, async (ctx) => {
    await leaveOrganization(ctx);
  });
  if (!r.ok) return r;
  redirect("/dashboard");
}
