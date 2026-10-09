"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { actionError, formToObject, type ActionResult } from "@/lib/action-result";
import { endSession, getRequestMeta, getSession, requireSession, startLaravelSession, startSession, switchOrganization } from "@/lib/auth/session";
import { laravel } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import type { LaravelIssuedSession } from "@/lib/laravel/session";
import { defaultOrganizationFor } from "@/lib/auth/session-store";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { audit } from "@/lib/audit";
import { isLocale, LOCALE_COOKIE } from "@/i18n";
import { createOrganizationWithOwner, ensurePermissionCatalogue } from "@/features/organizations/provision";
import { changePasswordSchema, forgotPasswordSchema, loginSchema, otpSchema, registerSchema, resetPasswordSchema } from "./schemas";
import {
  authenticate,
  changePassword,
  issueEmailVerification,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  sendPhoneOtp,
  verifyPhoneOtp,
} from "./service";

/** Only allow same-site relative redirects after login (prevents open redirects). */
function safeNext(next: unknown, fallback = "/dashboard") {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

export async function loginAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  let destination: string;
  try {
    const raw = formToObject(formData);
    const input = loginSchema.parse({ ...raw, remember: raw.remember === true });
    if (laravelEnabled("auth")) {
      // Laravel: argon2id verification, lockout, rate limits, audit; returns the session token once.
      const { data } = await laravel.post<LaravelIssuedSession>("auth/login", input, { auth: false });
      await startLaravelSession(data);
      destination = safeNext(raw.next, !data.organizationId && data.isStaff ? "/admin" : "/dashboard");
      redirect(destination);
    }
    const meta = await getRequestMeta();
    const user = await authenticate(input.identifier, input.password, meta);
    const orgId = await defaultOrganizationFor(user.id);
    await startSession(user.id, orgId, input.remember);
    const isStaff = user.platformRole !== "USER";
    destination = safeNext(raw.next, !orgId && isStaff ? "/admin" : "/dashboard");
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
  redirect(destination);
}

export async function registerAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const raw = formToObject(formData);
    const input = registerSchema.parse({ ...raw, acceptTerms: raw.acceptTerms === true });
    if (laravelEnabled("auth")) {
      // Laravel creates user + organization + wallet, sends the verification email and signs in.
      const { data } = await laravel.post<LaravelIssuedSession>("auth/register", input, { auth: false });
      await startLaravelSession(data);
      redirect("/dashboard?welcome=1");
    }
    const meta = await getRequestMeta();
    const { userId, organizationId } = await registerAccount(input, meta);
    try {
      await startSession(userId, organizationId, false);
    } catch (err) {
      logger.error({ err }, "registration succeeded but session could not be started");
      return { ok: false, error: "Your account was created, but we couldn't sign you in. Please sign in to continue.", code: "SESSION_FAILED" };
    }
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
  redirect("/dashboard?welcome=1");
}

export async function logoutAction() {
  // Laravel audits auth.logout itself when it revokes the session.
  if (!laravelEnabled("auth")) {
    const session = await getSession();
    if (session) await audit({ action: "auth.logout", actor: { type: "USER", userId: session.user.id } });
  }
  await endSession();
  redirect("/login");
}

export async function forgotPasswordAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const input = forgotPasswordSchema.parse(formToObject(formData));
    if (laravelEnabled("auth")) await laravel.post("auth/password/forgot", input, { auth: false });
    else await requestPasswordReset(input.email, await getRequestMeta());
    return { ok: true, message: "If an account exists for that email, a reset link is on its way. It expires in 1 hour." };
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
}

export async function resetPasswordAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const input = resetPasswordSchema.parse(formToObject(formData));
    if (laravelEnabled("auth")) await laravel.post("auth/password/reset", input, { auth: false });
    else await resetPassword(input.token, input.password, await getRequestMeta());
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
  redirect("/login?reset=1");
}

export async function resendVerificationAction(): Promise<ActionResult> {
  try {
    const session = await requireSession();
    if (laravelEnabled("auth")) {
      const { data } = await laravel.post<{ message: string }>("auth/email/resend");
      return { ok: true, message: data.message };
    }
    await issueEmailVerification(session.user.id);
    return { ok: true, message: `We sent a new verification link to ${session.user.email}.` };
  } catch (err) {
    return actionError(err);
  }
}

export async function sendOtpAction(): Promise<ActionResult> {
  try {
    const session = await requireSession();
    if (laravelEnabled("auth")) await laravel.post("auth/phone/otp");
    else await sendPhoneOtp(session.user.id);
    return { ok: true, message: "We sent a 6-digit code to your mobile number." };
  } catch (err) {
    return actionError(err);
  }
}

export async function verifyOtpAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireSession();
    const { code } = otpSchema.parse(formToObject(formData));
    if (laravelEnabled("auth")) await laravel.post("auth/phone/verify", { code });
    else await verifyPhoneOtp(session.user.id, code);
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
  redirect("/dashboard/settings?phone=verified");
}

export async function changePasswordAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireSession();
    const input = changePasswordSchema.parse(formToObject(formData));
    if (laravelEnabled("auth")) await laravel.put("profile/password", input);
    else await changePassword(session.user.id, input.currentPassword, input.password, session.sessionId, await getRequestMeta());
    return { ok: true, message: "Password updated. Other sessions were signed out." };
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
}

export async function switchOrganizationAction(organizationId: string) {
  const ok = await switchOrganization(organizationId);
  if (!ok) throw new AppError("FORBIDDEN", "You are not a member of that organization.");
  redirect("/dashboard");
}

export async function setLocaleAction(locale: string) {
  if (!isLocale(locale)) return;
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const session = await getSession();
  if (!session) return;
  if (laravelEnabled("profile")) await laravel.put("profile/locale", { locale });
  else await db.user.update({ where: { id: session.user.id }, data: { locale } });
}

const onboardingSchema = z.object({ company: z.string().trim().min(2, "Enter your organization name.").max(120) });

/** For signed-in users who no longer belong to any organization. */
export async function createOrganizationAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const session = await requireSession();
    const { company } = onboardingSchema.parse(formToObject(formData));
    if (laravelEnabled("auth")) {
      // Laravel provisions the organization (roles, wallet) and makes it the session's active one.
      await laravel.post("auth/organizations", { company });
      redirect("/dashboard");
    }
    await ensurePermissionCatalogue();
    const { org } = await db.$transaction((tx) => createOrganizationWithOwner(tx, { name: company, ownerUserId: session.user.id }));
    await switchOrganization(org.id);
    await audit({ action: "organization.create", actor: { type: "USER", userId: session.user.id }, organizationId: org.id });
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
  redirect("/dashboard");
}
