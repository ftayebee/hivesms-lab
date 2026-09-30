import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { authenticate, registerAccount, resetPassword, verifyEmailToken } from "@/features/auth/service";
import { createSession, resolveSessionToken } from "@/lib/auth/session-store";
import { resetDatabase, TEST_PASSWORD, createUser } from "../support/factories";

const input = (email: string, phone = "01711223344") => ({
  name: "Rahima Khatun",
  company: "Example Traders",
  email,
  phone: `+880${phone.slice(1)}`,
  password: "Correct-Horse-42",
  confirmPassword: "Correct-Horse-42",
  acceptTerms: true as const,
});

describe("registration", () => {
  beforeEach(resetDatabase);

  it("creates the user, organization, five roles, owner membership and an empty wallet", async () => {
    const { userId, organizationId } = await registerAccount(input("rahima@example.com"), { ip: "198.51.100.1" });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.emailVerifiedAt).toBeNull();
    const roles = await db.role.findMany({ where: { organizationId } });
    expect(roles.map((r) => r.key).sort()).toEqual(["ADMIN", "DEVELOPER", "MANAGER", "OWNER", "VIEWER"]);
    const membership = await db.organizationMember.findFirstOrThrow({ where: { userId }, include: { role: true } });
    expect(membership.role.key).toBe("OWNER");
    expect(Number((await db.wallet.findUniqueOrThrow({ where: { organizationId } })).balance)).toBe(0);
    expect(await db.verificationToken.count({ where: { userId, type: "EMAIL_VERIFY" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "auth.register", actorUserId: userId } })).toBe(1);
  });

  it("rejects a duplicate email or phone", async () => {
    await registerAccount(input("dup@example.com"), { ip: "198.51.100.2" });
    await expect(registerAccount(input("dup@example.com", "01799887766"), { ip: "198.51.100.2" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(registerAccount(input("other@example.com"), { ip: "198.51.100.2" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("verifies email with a single-use token", async () => {
    const user = await createUser({ verified: false });
    const token = randomToken();
    await db.verificationToken.create({ data: { userId: user.id, type: "EMAIL_VERIFY", tokenHash: sha256(token), target: user.email, expiresAt: new Date(Date.now() + 3600_000) } });
    await verifyEmailToken(token);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).not.toBeNull();
    await expect(verifyEmailToken(token)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("login", () => {
  beforeEach(resetDatabase);

  it("signs in by email or phone and resets the failure counter", async () => {
    const user = await createUser({ email: "login@example.com" });
    await db.user.update({ where: { id: user.id }, data: { phone: "+8801755512345", failedLoginCount: 3 } });
    expect((await authenticate("LOGIN@example.com", TEST_PASSWORD, { ip: "198.51.100.10" })).id).toBe(user.id);
    expect((await authenticate("01755512345", TEST_PASSWORD, { ip: "198.51.100.10" })).id).toBe(user.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount).toBe(0);
  });

  it("uses the same error for unknown accounts and wrong passwords", async () => {
    await createUser({ email: "known@example.com" });
    const a = await authenticate("unknown@example.com", "whatever", { ip: "198.51.100.11" }).catch((e) => e.message);
    const b = await authenticate("known@example.com", "wrong-password", { ip: "198.51.100.11" }).catch((e) => e.message);
    expect(a).toBe(b);
  });

  it("locks the account after five failed attempts, even with the right password", async () => {
    await createUser({ email: "lock@example.com" });
    for (let i = 0; i < 5; i++) await authenticate("lock@example.com", "wrong", { ip: `198.51.100.${20 + i}` }).catch(() => {});
    const u = await db.user.findUniqueOrThrow({ where: { email: "lock@example.com" } });
    expect(u.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    await expect(authenticate("lock@example.com", TEST_PASSWORD, { ip: "198.51.100.40" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await db.auditLog.count({ where: { action: "auth.account_locked" } })).toBe(1);
  });

  it("refuses suspended users", async () => {
    const u = await createUser({ email: "suspended@example.com" });
    await db.user.update({ where: { id: u.id }, data: { status: "SUSPENDED" } });
    await expect(authenticate("suspended@example.com", TEST_PASSWORD, { ip: "198.51.100.50" })).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
  });
});

describe("sessions and password reset", () => {
  beforeEach(resetDatabase);

  it("stores only a hash of the session token and resolves it", async () => {
    const u = await createUser();
    const { token } = await createSession({ userId: u.id, organizationId: null, remember: false });
    const row = await db.session.findFirstOrThrow({ where: { userId: u.id } });
    expect(row.tokenHash).toBe(sha256(token));
    expect(row.tokenHash).not.toContain(token);
    expect((await resolveSessionToken(token))?.user.id).toBe(u.id);
    expect(await resolveSessionToken("nope")).toBeNull();
  });

  it("resetting a password invalidates every existing session", async () => {
    const u = await createUser();
    const s1 = await createSession({ userId: u.id, organizationId: null, remember: true });
    const token = randomToken();
    await db.verificationToken.create({ data: { userId: u.id, type: "PASSWORD_RESET", tokenHash: sha256(token), target: u.email, expiresAt: new Date(Date.now() + 3600_000) } });
    await resetPassword(token, "Brand-New-Pass-77", { ip: "198.51.100.60" });
    expect(await resolveSessionToken(s1.token)).toBeNull();
    await expect(resetPassword(token, "Another-Pass-88", {})).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await authenticate(u.email, "Brand-New-Pass-77", { ip: "198.51.100.61" })).id).toBe(u.id);
  });

  it("rejects expired reset tokens", async () => {
    const u = await createUser();
    const token = randomToken();
    await db.verificationToken.create({ data: { userId: u.id, type: "PASSWORD_RESET", tokenHash: sha256(token), expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPassword(token, "Brand-New-Pass-77", {})).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});
