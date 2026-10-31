"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actionError, formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { getSession, startLaravelSession, startSession, switchOrganization } from "@/lib/auth/session";
import { laravel } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import type { LaravelIssuedSession } from "@/lib/laravel/session";
import { passwordSchema } from "@/lib/auth/password";
import { normalizeBdPhone } from "@/lib/phone";
import { AppError } from "@/lib/errors";
import { acceptInvitation, changeMemberRole, createUserForInvitation, inviteMember, inviteSchema, inviteSignupSchema, revokeInvitation, setMemberStatus, updateRolePermissions } from "./service";

const roleKey = z.enum(["OWNER", "ADMIN", "MANAGER", "DEVELOPER", "VIEWER"]);
const done = (message: string): ActionResult => {
  revalidatePath("/dashboard/team");
  return { ok: true, message };
};

export async function inviteAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "team:manage",
    async (ctx) => {
      const inv = await inviteMember(ctx, inviteSchema.parse(raw));
      return done(`Invitation sent to ${inv.email}.`);
    },
    { raw },
  );
}

export async function revokeInviteAction(id: string): Promise<ActionResult> {
  return tenantAction("team:manage", async (ctx) => {
    await revokeInvitation(ctx, z.uuid().parse(id));
    return done("Invitation revoked.");
  });
}

export async function changeRoleAction(memberId: string, role: string): Promise<ActionResult> {
  return tenantAction("team:manage", async (ctx) => {
    await changeMemberRole(ctx, z.uuid().parse(memberId), roleKey.parse(role));
    return done("Role updated.");
  });
}

export async function memberStatusAction(memberId: string, action: "remove" | "disable" | "enable"): Promise<ActionResult> {
  return tenantAction("team:manage", async (ctx) => {
    await setMemberStatus(ctx, z.uuid().parse(memberId), z.enum(["remove", "disable", "enable"]).parse(action));
    return done(action === "remove" ? "Member removed." : action === "disable" ? "Member disabled." : "Member re-enabled.");
  });
}

export async function updateRolePermissionsAction(role: string, permissions: string[]): Promise<ActionResult> {
  return tenantAction("team:manage", async (ctx) => {
    await updateRolePermissions(ctx, roleKey.parse(role), z.array(z.string().max(60)).max(100).parse(permissions));
    return done("Permissions saved. They apply on the member's next request.");
  });
}

// ─── Invitation acceptance (public page) ───

export async function acceptInviteAction(token: string): Promise<ActionResult> {
  let orgId: string;
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHORIZED", "Sign in first.");
    if (laravelEnabled("auth")) {
      // Laravel checks the invited email, joins the organization and makes it the active one.
      await laravel.post("auth/invitations/accept", { token });
      redirect("/dashboard?joined=1");
    }
    orgId = await acceptInvitation(token, session.user.id);
    await switchOrganization(orgId);
  } catch (err) {
    return actionError(err);
  }
  redirect("/dashboard?joined=1");
}

export async function inviteSignupAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  try {
    const input = inviteSignupSchema.parse(raw);
    passwordSchema.parse(input.password);
    const phone = input.phone ? normalizeBdPhone(input.phone) : null;
    if (input.phone && !phone) throw new AppError("VALIDATION_ERROR", "Enter a valid Bangladesh mobile number.", { field: "phone" });
    const token = String(raw.token ?? "");
    if (laravelEnabled("auth")) {
      const { data } = await laravel.post<LaravelIssuedSession>(
        "auth/invitations/signup",
        { token, name: input.name, phone, password: input.password, confirmPassword: input.confirmPassword },
        { auth: false },
      );
      await startLaravelSession(data);
      redirect("/dashboard?joined=1");
    }
    const user = await createUserForInvitation(token, { name: input.name, phone, password: input.password });
    const orgId = await acceptInvitation(token, user.id);
    await startSession(user.id, orgId, false);
  } catch (err) {
    // passwordSchema errors are ZodErrors on the root path; map them to the password field.
    const r = actionError(err, raw);
    if (!r.ok && r.fieldErrors?._) r.fieldErrors = { ...r.fieldErrors, password: r.fieldErrors._ };
    return r;
  }
  redirect("/dashboard?joined=1");
}
