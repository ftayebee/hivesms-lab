import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { AdminContext } from "@/features/admin/guard";
import { adjustWallet, setOrganizationStatus, updateUserAccess } from "@/features/admin/service";
import { savePlan, planSchema } from "@/features/admin/config";
import { balanceOf, createTenant, createUser, resetDatabase, TEST_PASSWORD } from "../support/factories";

/**
 * The Prisma admin path (flags off — what production runs until the `admin` flag) keeps the same
 * safety rules as the Laravel Super Admin API (docs/17 S1–S3, S5, S7).
 */
const ctx = (u: { id: string; name: string }, role: AdminContext["role"] = "SUPER_ADMIN"): AdminContext => ({ userId: u.id, name: u.name, role, ip: "127.0.0.1", userAgent: "vitest" });
const key = () => `adj_${randomUUID().replaceAll("-", "")}`;

describe("admin safety on the Prisma path", () => {
  beforeEach(resetDatabase);

  it("wallet adjustments need the password, apply once per key and never overdraw", async () => {
    const owner = await createUser({ platformRole: "SUPER_ADMIN" });
    const { org } = await createTenant({ balance: 10 });
    const k = key();
    const input = { direction: "CREDIT" as const, amount: "5.50", note: "Goodwill credit", idempotencyKey: k, currentPassword: TEST_PASSWORD };
    await expect(adjustWallet(ctx(owner), org.id, { ...input, currentPassword: "wrong-password" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await adjustWallet(ctx(owner), org.id, input)).toEqual({ replayed: false });
    expect(await adjustWallet(ctx(owner), org.id, input)).toEqual({ replayed: true });
    await expect(adjustWallet(ctx(owner), org.id, { ...input, amount: "6.00" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await balanceOf(org.id)).toBeCloseTo(15.5);
    await expect(adjustWallet(ctx(owner), org.id, { ...input, direction: "DEBIT", amount: "100", idempotencyKey: key() })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(await balanceOf(org.id)).toBeCloseTo(15.5);
    expect(await db.walletTransaction.count({ where: { referenceType: "admin_adjustment", referenceId: k } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "admin.reauth.failed" } })).toBe(1);
    expect(JSON.stringify(await db.auditLog.findMany())).not.toContain("wrong-password");
  });

  it("five wrong passwords lock privileged actions", async () => {
    const owner = await createUser({ platformRole: "SUPER_ADMIN" });
    const { org } = await createTenant({ balance: 10 });
    for (let i = 0; i < 5; i++) {
      await expect(adjustWallet(ctx(owner), org.id, { direction: "CREDIT", amount: "1", note: "Goodwill credit", idempotencyKey: key(), currentPassword: `guess-${i}` })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    await expect(adjustWallet(ctx(owner), org.id, { direction: "CREDIT", amount: "1", note: "Goodwill credit", idempotencyKey: key(), currentPassword: TEST_PASSWORD })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(await balanceOf(org.id)).toBeCloseTo(10);
  });

  it("the last active super admin can be neither demoted nor suspended; changes are audited with the reason", async () => {
    const a = await createUser({ platformRole: "SUPER_ADMIN" });
    const b = await createUser({ platformRole: "SUPER_ADMIN" });
    await expect(updateUserAccess(ctx(a), a.id, { platformRole: "USER", reason: "demote myself", currentPassword: TEST_PASSWORD })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateUserAccess(ctx(a), b.id, { platformRole: "ADMIN", reason: "moves to admin", currentPassword: TEST_PASSWORD });
    // A request racing it (B's context still says super admin) cannot remove the last owner.
    for (const change of [{ platformRole: "ADMIN" as const }, { status: "SUSPENDED" as const }]) {
      await expect(updateUserAccess(ctx(b), a.id, { ...change, reason: "race condition", currentPassword: TEST_PASSWORD })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    const after = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    expect([after.platformRole, after.status]).toEqual(["SUPER_ADMIN", "ACTIVE"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "admin.user.access_update", targetId: b.id } });
    expect(log.metadata).toMatchObject({ reason: "moves to admin", before: { platformRole: "SUPER_ADMIN" }, after: { platformRole: "ADMIN" } });
  });

  it("reactivation and plan updates need a reason", async () => {
    const owner = await createUser({ platformRole: "SUPER_ADMIN" });
    const { org } = await createTenant();
    await setOrganizationStatus(ctx(owner), org.id, "SUSPENDED", "Spam complaints");
    await expect(setOrganizationStatus(ctx(owner), org.id, "ACTIVE", null)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await setOrganizationStatus(ctx(owner), org.id, "ACTIVE", "Resolved");
    const plan = await db.pricingPlan.findFirstOrThrow();
    const form = planSchema.parse({ ...plan, minRechargeAmount: plan.minRechargeAmount.toString(), transactionalNonMasking: "0.45", transactionalMasking: plan.transactionalMasking.toString(), promotionalNonMasking: plan.promotionalNonMasking.toString(), promotionalMasking: plan.promotionalMasking.toString(), senderIdFee: plan.senderIdFee.toString(), features: "", description: plan.description ?? "" });
    await expect(savePlan(ctx(owner), form, plan.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await savePlan(ctx(owner), { ...form, reason: "Provider price increase" }, plan.id);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "pricing.plan.update", targetId: plan.id } });
    expect((log.metadata as { reason: string }).reason).toBe("Provider price increase");
  });
});
