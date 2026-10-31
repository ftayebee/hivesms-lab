import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { isDatabaseUnavailable, uniqueViolationTarget } from "@/lib/db-errors";
import { AppError, isAppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { logger, maskEmail, maskPhone } from "@/lib/logger";
import { hmacSha256, randomNumericCode, randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { burnPasswordCheck, hashPassword, verifyPassword } from "@/lib/auth/password";
import { revokeAllUserSessions } from "@/lib/auth/session-store";
import { rateLimit, RateLimits } from "@/lib/rate-limit";
import { normalizeBdPhone } from "@/lib/phone";
import { sendEmail } from "@/services/email";
import { emailTemplates } from "@/services/email/templates";
import { getSmsProvider } from "@/services/sms";
import { calculateSegments } from "@/lib/sms-segments";
import { createOrganizationWithOwner, ensurePermissionCatalogue } from "@/features/organizations/provision";
import type { RegisterInput } from "./schemas";

/**
 * Authentication business logic. Framework-agnostic: server actions and /api/v1/auth routes both
 * call these functions and handle cookies themselves.
 */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const EMAIL_TOKEN_HOURS = 24;
const RESET_TOKEN_MINUTES = 60;
const OTP_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const appUrl = (path: string) => `${process.env.APP_URL ?? "http://localhost:3000"}${path}`;

export function registrationOpen() {
  return process.env.FEATURE_REGISTRATION_OPEN !== "false";
}

export function phoneVerificationEnabled() {
  return process.env.FEATURE_PHONE_VERIFICATION === "true";
}

const EMAIL_TAKEN = "An account with this email already exists. Sign in instead.";
const PHONE_TAKEN = "This mobile number is already registered.";

/** Maps database failures during sign-up to safe, specific messages (details are only logged). */
function registrationError(err: unknown): unknown {
  if (isAppError(err)) return err;
  const unique = uniqueViolationTarget(err);
  // Two concurrent sign-ups can both pass the pre-check; the unique index decides.
  if (unique && /phone/i.test(unique)) return new AppError("CONFLICT", PHONE_TAKEN, { field: "phone" });
  if (unique && /email/i.test(unique)) return new AppError("CONFLICT", EMAIL_TAKEN, { field: "email" });
  logger.error({ err, databaseUnavailable: isDatabaseUnavailable(err) }, "registration failed");
  return new AppError("INTERNAL_ERROR", "We couldn't create your account right now. Please try again shortly.");
}

export async function registerAccount(input: RegisterInput, meta: RequestMeta) {
  if (!registrationOpen()) throw new AppError("FEATURE_DISABLED", "Registration is currently closed. Contact sales to open an account.");

  let created: { user: { id: string; email: string; name: string }; org: { id: string } };
  try {
    const rl = await rateLimit(`register:${meta.ip ?? "unknown"}`, RateLimits.registerPerIp);
    if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many sign-up attempts from this network. Try again later.");

    const existing = await db.user.findFirst({ where: { OR: [{ email: input.email }, { phone: input.phone }] }, select: { email: true } });
    if (existing) {
      const emailTaken = existing.email === input.email;
      throw new AppError("CONFLICT", emailTaken ? EMAIL_TAKEN : PHONE_TAKEN, { field: emailTaken ? "email" : "phone" });
    }

    const passwordHash = await hashPassword(input.password);
    await ensurePermissionCatalogue();
    // User, organization, roles, owner membership, wallet and audit entry commit together or not at all.
    created = await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name: input.name, email: input.email, phone: input.phone, passwordHash } });
      const { org } = await createOrganizationWithOwner(tx, { name: input.company, ownerUserId: user.id });
      await audit({ action: "auth.register", actor: { type: "USER", userId: user.id }, organizationId: org.id, ip: meta.ip, userAgent: meta.userAgent }, tx);
      return { user, org };
    });
  } catch (err) {
    throw registrationError(err);
  }

  const { user, org } = created;
  // The account exists from here on: follow-up emails must not turn a successful sign-up into an error
  // (the user can resend the verification link from the dashboard).
  try {
    await issueEmailVerification(user.id);
  } catch (err) {
    logger.error({ err, user: maskEmail(user.email) }, "could not issue email verification after registration");
  }
  await sendEmail(emailTemplates.welcome(user.email, user.name));
  logger.info({ user: maskEmail(user.email) }, "account registered");
  return { userId: user.id, organizationId: org.id };
}

export async function authenticate(identifier: string, password: string, meta: RequestMeta) {
  const ipLimit = await rateLimit(`login-ip:${meta.ip ?? "unknown"}`, RateLimits.loginPerIp);
  const idKey = identifier.trim().toLowerCase();
  const accountLimit = await rateLimit(`login-acct:${sha256(idKey)}`, RateLimits.loginPerAccount);
  if (!ipLimit.allowed || !accountLimit.allowed) {
    throw new AppError("RATE_LIMITED", "Too many sign-in attempts. Wait a few minutes and try again.");
  }

  const phone = normalizeBdPhone(identifier);
  const user = await db.user.findFirst({
    where: { deletedAt: null, OR: [{ email: idKey }, ...(phone ? [{ phone }] : [])] },
  });
  const invalid = new AppError("UNAUTHORIZED", "The email/phone or password is incorrect.");

  if (!user) {
    await burnPasswordCheck(password);
    await audit({ action: "auth.login_failed", actor: { type: "SYSTEM" }, ip: meta.ip, userAgent: meta.userAgent, metadata: { reason: "unknown_account" } });
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await burnPasswordCheck(password);
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError("RATE_LIMITED", `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`);
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db.user.update({
      where: { id: user.id },
      data: lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLoginCount: failed },
    });
    await audit({
      action: lock ? "auth.account_locked" : "auth.login_failed",
      actor: { type: "USER", userId: user.id },
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { attempts: failed },
    });
    throw invalid;
  }
  if (user.status === "SUSPENDED") {
    throw new AppError("ACCOUNT_SUSPENDED", "This user account is suspended. Contact support.");
  }

  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await audit({ action: "auth.login", actor: { type: "USER", userId: user.id }, ip: meta.ip, userAgent: meta.userAgent });
  return user;
}

// ─── Email verification ───

export async function issueEmailVerification(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const token = randomToken(32);
  await db.verificationToken.deleteMany({ where: { userId, type: "EMAIL_VERIFY", consumedAt: null } });
  await db.verificationToken.create({
    data: { userId, type: "EMAIL_VERIFY", tokenHash: sha256(token), target: user.email, expiresAt: new Date(Date.now() + EMAIL_TOKEN_HOURS * 3600_000) },
  });
  await sendEmail(emailTemplates.verifyEmail(user.email, user.name, appUrl(`/verify-email?token=${token}`)));
}

export async function verifyEmailToken(token: string) {
  const row = await db.verificationToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.type !== "EMAIL_VERIFY" || row.consumedAt || row.expiresAt < new Date() || row.target !== row.user.email) {
    throw new AppError("INVALID_REQUEST", "This verification link is invalid or has expired. Request a new one from your dashboard.");
  }
  await db.$transaction([
    db.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    db.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  await audit({ action: "auth.email_verified", actor: { type: "USER", userId: row.userId } });
  return row.userId;
}

// ─── Password reset ───

export async function requestPasswordReset(email: string, meta: RequestMeta) {
  const rl = await rateLimit(`pwreset:${meta.ip ?? "unknown"}`, RateLimits.passwordResetPerIp);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many reset requests. Try again later.");
  const user = await db.user.findFirst({ where: { email, deletedAt: null, status: "ACTIVE" } });
  // Always behave the same whether or not the account exists (no account enumeration).
  if (!user) return;
  const token = randomToken(32);
  await db.verificationToken.deleteMany({ where: { userId: user.id, type: "PASSWORD_RESET", consumedAt: null } });
  await db.verificationToken.create({
    data: { userId: user.id, type: "PASSWORD_RESET", tokenHash: sha256(token), target: user.email, expiresAt: new Date(Date.now() + RESET_TOKEN_MINUTES * 60_000) },
  });
  await sendEmail(emailTemplates.passwordReset(user.email, user.name, appUrl(`/reset-password?token=${token}`)));
  await audit({ action: "auth.password_reset_requested", actor: { type: "USER", userId: user.id }, ip: meta.ip });
}

export async function resetPassword(token: string, password: string, meta: RequestMeta) {
  const row = await db.verificationToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.type !== "PASSWORD_RESET" || row.consumedAt || row.expiresAt < new Date()) {
    throw new AppError("INVALID_REQUEST", "This reset link is invalid or has expired. Request a new one.");
  }
  const passwordHash = await hashPassword(password);
  await db.$transaction([
    db.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    db.user.update({
      where: { id: row.userId },
      data: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: row.user.emailVerifiedAt ?? new Date() },
    }),
  ]);
  await revokeAllUserSessions(row.userId);
  await audit({ action: "auth.password_reset", actor: { type: "USER", userId: row.userId }, ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail(emailTemplates.passwordChanged(row.user.email, row.user.name));
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepSessionId: string, meta: RequestMeta) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError("VALIDATION_ERROR", "Your current password is incorrect.", { field: "currentPassword" });
  }
  const passwordHash = await hashPassword(newPassword);
  await db.user.update({ where: { id: userId }, data: { passwordHash } });
  // Keep the current session alive; revoke every other session.
  await revokeAllUserSessions(userId, keepSessionId);
  await audit({ action: "auth.password_changed", actor: { type: "USER", userId }, ip: meta.ip, userAgent: meta.userAgent });
  await sendEmail(emailTemplates.passwordChanged(user.email, user.name));
}

// ─── Phone verification (OTP) ───

function otpHash(tokenId: string, code: string) {
  return hmacSha256(process.env.AUTH_SECRET ?? "", `${tokenId}:${code}`);
}

export async function sendPhoneOtp(userId: string) {
  if (!phoneVerificationEnabled()) throw new AppError("FEATURE_DISABLED", "Phone verification is not enabled.");
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.phone) throw new AppError("VALIDATION_ERROR", "Add a mobile number to your profile first.");
  const rl = await rateLimit(`otp:${userId}`, RateLimits.otpPerUser);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many codes requested. Try again in an hour.");

  const code = randomNumericCode(6);
  const id = randomUUID();
  await db.verificationToken.deleteMany({ where: { userId, type: "PHONE_OTP", consumedAt: null } });
  await db.verificationToken.create({
    data: { id, userId, type: "PHONE_OTP", tokenHash: otpHash(id, code), target: user.phone, expiresAt: new Date(Date.now() + OTP_MINUTES * 60_000) },
  });

  // Platform system message: sent directly through the provider and not billed to the customer.
  const provider = await getSmsProvider();
  const message = `Your verification code is ${code}. It expires in ${OTP_MINUTES} minutes. Do not share it.`;
  const result = await provider.sendSms({
    reference: `otp:${id}`,
    to: user.phone,
    message,
    senderId: process.env.SMS_DEFAULT_SENDER_ID ?? "",
    senderType: "NON_MASKING",
    smsType: "TRANSACTIONAL",
    encoding: calculateSegments(message).encoding,
  });
  if (!result.ok) {
    logger.error({ to: maskPhone(user.phone), code: result.errorCode }, "OTP send failed");
    throw new AppError("PROVIDER_ERROR", "We could not send the code right now. Try again in a minute.");
  }
  if (provider.key === "mock" && process.env.NODE_ENV !== "production") {
    console.log(`\n── DEV OTP for ${user.phone}: ${code}\n`);
  }
}

export async function verifyPhoneOtp(userId: string, code: string) {
  const row = await db.verificationToken.findFirst({
    where: { userId, type: "PHONE_OTP", consumedAt: null },
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });
  if (!row || row.expiresAt < new Date()) throw new AppError("INVALID_REQUEST", "The code has expired. Request a new one.");
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new AppError("RATE_LIMITED", "Too many incorrect attempts. Request a new code.");
  if (!safeEqual(row.tokenHash, otpHash(row.id, code)) || row.target !== row.user.phone) {
    await db.verificationToken.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw new AppError("VALIDATION_ERROR", "That code is incorrect.", { field: "code" });
  }
  await db.$transaction([
    db.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } }),
    db.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } }),
  ]);
  await audit({ action: "auth.phone_verified", actor: { type: "USER", userId } });
}
