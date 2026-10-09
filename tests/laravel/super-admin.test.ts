import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { LaravelApiError } from "@/lib/laravel-api";
import type { AdminContext } from "@/features/admin/guard";
import { adjustWallet, updateUserAccess } from "@/features/admin/service";
import { financeSummary, platformDashboard, systemHealth } from "@/features/admin/super-admin";
import { GET as exportRoute } from "@/app/api/v1/admin/exports/[kind]/route";
import { api, nextRequest, params, PASSWORD, register, RUN, type TestAccount } from "../support/laravel-helpers";

/**
 * Super Admin panel through the Next.js BFF against a LOCAL Laravel (LARAVEL_FEATURES=all): the
 * service functions and the export route the admin pages use, as a customer, support staff and a
 * super admin. Staff accounts are created in the local test database only. Run command: see
 * tests/laravel/proxy-routes.test.ts.
 */

const scope = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "sf_session" && scope.token ? { name, value: scope.token } : undefined) }),
  headers: async () => new Headers({ "user-agent": "vitest-super-admin" }),
}));

async function as<T>(token: string, fn: () => Promise<T>): Promise<T> {
  scope.token = token;
  try {
    return await fn();
  } finally {
    scope.token = undefined;
  }
}

const failure = async (p: Promise<unknown>) => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err, "expected the call to fail").toBeTruthy();
  return err as LaravelApiError & { code?: string };
};

/** Staff account in the LOCAL test database, signed in through Laravel. */
async function staff(role: "SUPPORT" | "ADMIN" | "SUPER_ADMIN") {
  const email = `staff-${role.toLowerCase()}-${RUN}@example.com`;
  const user = await db.user.create({ data: { email, name: `Staff ${role}`, passwordHash: await hashPassword(PASSWORD), platformRole: role, emailVerifiedAt: new Date() } });
  const login = await api<{ token: string }>("auth/login", { body: { identifier: email, password: PASSWORD } });
  expect(login.status, JSON.stringify(login.json)).toBe(200);
  const ctx: AdminContext = { userId: user.id, name: user.name, role, ip: null, userAgent: "vitest" };
  return { user, token: login.json!.data.token, ctx };
}

let customer: TestAccount;
let owner: Awaited<ReturnType<typeof staff>>;
let support: Awaited<ReturnType<typeof staff>>;

beforeAll(async () => {
  customer = await register("sa-customer", { verified: true });
  owner = await staff("SUPER_ADMIN");
  support = await staff("SUPPORT");
});

const balance = async () => (await db.wallet.findUniqueOrThrow({ where: { organizationId: customer.organizationId! } })).balance.toString();

describe("platform administration through the BFF", () => {
  it("customers are refused by the API, whatever the UI would show", async () => {
    expect((await failure(as(customer.token, () => platformDashboard({ range: "7d" })))).status).toBe(403);
    expect((await failure(as(customer.token, () => financeSummary({ range: "7d" })))).status).toBe(403);
    scope.token = customer.token;
    const res = await exportRoute(nextRequest("/api/v1/admin/exports/customers"), params({ kind: "customers" }));
    scope.token = undefined;
    expect(res.status).toBe(403);
  });

  it("support staff see the dashboard without finance, and cannot export or move money", async () => {
    const d = await as(support.token, () => platformDashboard({ range: "7d" }));
    expect(d.customers.total).toBeGreaterThan(0);
    expect(d.finance).toBeNull();
    expect((await failure(as(support.token, () => financeSummary({ range: "7d" })))).status).toBe(403);
    scope.token = support.token;
    expect((await exportRoute(nextRequest("/api/v1/admin/exports/payments"), params({ kind: "payments" }))).status).toBe(403);
    scope.token = undefined;
    const err = await failure(as(support.token, () => adjustWallet(support.ctx, customer.organizationId!, { direction: "CREDIT", amount: "10", note: "Not allowed", idempotencyKey: `adj_${randomUUID().replaceAll("-", "")}`, currentPassword: PASSWORD })));
    expect(err.status).toBe(403);
  });

  it("a super admin gets real aggregates: liability is separate from receipts and revenue", async () => {
    const d = await as(owner.token, () => platformDashboard({ range: "today" }));
    const liability = (await db.wallet.aggregate({ _sum: { balance: true } }))._sum.balance!.toFixed(2);
    expect(d.finance!.liability.balance).toBe(liability);
    expect(d.subscriptions.supported).toBe(false);
    expect(["estimate", "not_configured"]).toContain(d.finance!.providerCost.basis);
    expect((await as(owner.token, () => systemHealth())).checks.database).toBe("ok");
  });

  it("wallet adjustments need the password, apply once per key and never overdraw", async () => {
    const key = `adj_${randomUUID().replaceAll("-", "")}`;
    const input = { direction: "CREDIT" as const, amount: "25.50", note: "Goodwill credit", idempotencyKey: key, currentPassword: PASSWORD };
    const before = await balance();
    const wrong = await failure(as(owner.token, () => adjustWallet(owner.ctx, customer.organizationId!, { ...input, currentPassword: "not-my-password" })));
    expect(wrong.status).toBe(422);
    expect(await balance()).toBe(before);
    expect(await as(owner.token, () => adjustWallet(owner.ctx, customer.organizationId!, input))).toEqual({ replayed: false });
    expect(await as(owner.token, () => adjustWallet(owner.ctx, customer.organizationId!, input))).toEqual({ replayed: true });
    expect(Number(await balance())).toBeCloseTo(Number(before) + 25.5, 4);
    const over = await failure(as(owner.token, () => adjustWallet(owner.ctx, customer.organizationId!, { ...input, direction: "DEBIT", amount: "99999", idempotencyKey: `adj_${randomUUID().replaceAll("-", "")}` })));
    expect(over.status).toBe(402);
    expect(Number(await balance())).toBeGreaterThanOrEqual(0);
  });

  it("staff cannot change their own access; changes need a reason and the password", async () => {
    const self = await failure(as(owner.token, () => updateUserAccess(owner.ctx, owner.user.id, { platformRole: "USER", reason: "demote myself", currentPassword: PASSWORD })));
    expect(self.code ?? self.kind).toMatch(/FORBIDDEN|forbidden/);
    const wrong = await failure(as(owner.token, () => updateUserAccess(owner.ctx, support.user.id, { platformRole: "ADMIN", reason: "promotion", currentPassword: "nope-nope" })));
    expect(wrong.status).toBe(422);
    expect((await db.user.findUniqueOrThrow({ where: { id: support.user.id } })).platformRole).toBe("SUPPORT");
  });

  it("exports stream CSV through Next.js without personal data or secrets, and are audited", async () => {
    for (const kind of ["customers", "payments", "transactions", "audit-logs"]) {
      scope.token = owner.token;
      const res = await exportRoute(nextRequest(`/api/v1/admin/exports/${kind}?range=today`), params({ kind }));
      scope.token = undefined;
      expect(res.status, kind).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/csv");
      const csv = await res.text();
      expect(csv).not.toContain(customer.email);
      expect(csv).not.toMatch(/passwordHash|keyHash|argon2|sfk_live_/);
    }
    expect(await db.auditLog.count({ where: { action: "admin.export", actorUserId: owner.user.id } })).toBe(4);
    const logs = JSON.stringify(await db.auditLog.findMany({ where: { actorUserId: owner.user.id } }));
    expect(logs).not.toContain(PASSWORD);
    expect(logs).not.toContain("not-my-password");
  });
});
