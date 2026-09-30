import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { drainWrites } from "@/lib/background-writes";
import { hashPassword } from "@/lib/auth/password";
import { buildTenantContext } from "@/lib/auth/session-store";
import { generateApiKey } from "@/lib/api/api-keys";
import { clearSettingsCache } from "@/services/settings";
import { defaultCreditPackages, defaultPlans } from "@/config/pricing";
import { createOrganizationWithOwner, ensurePermissionCatalogue } from "@/features/organizations/provision";

export const TEST_PASSWORD = "Integration-Test-2026";

/** Empties every table (fast TRUNCATE) and re-creates the catalogue data the app needs. */
export async function resetDatabase() {
  await drainWrites();
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  clearSettingsCache();
  await ensurePermissionCatalogue();
  for (const p of defaultPlans) await db.pricingPlan.create({ data: p });
  for (const p of defaultCreditPackages) await db.creditPackage.create({ data: p });
}

export async function createUser(overrides: { email?: string; platformRole?: "USER" | "ADMIN" | "SUPER_ADMIN" | "SUPPORT"; verified?: boolean } = {}) {
  return db.user.create({
    data: {
      email: overrides.email ?? `user-${randomUUID().slice(0, 8)}@test.local`,
      name: "Test User",
      passwordHash: await hashPassword(TEST_PASSWORD),
      platformRole: overrides.platformRole ?? "USER",
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
    },
  });
}

/** Organization with an owner, wallet balance and optional overrides; returns the tenant context. */
export async function createTenant(opts: { balance?: number; name?: string; requireCampaignReview?: boolean; dailySendLimit?: number } = {}) {
  const user = await createUser();
  const { org } = await db.$transaction((tx) => createOrganizationWithOwner(tx, { name: opts.name ?? "Test Org", ownerUserId: user.id }));
  await db.organization.update({
    where: { id: org.id },
    data: { requireCampaignReview: opts.requireCampaignReview ?? false, dailySendLimit: opts.dailySendLimit ?? 10_000, monthlySendLimit: 100_000 },
  });
  if (opts.balance) await db.wallet.update({ where: { organizationId: org.id }, data: { balance: opts.balance } });
  const ctx = (await buildTenantContext(user.id, org.id))!;
  return { user, org, ctx };
}

export async function createApiKeyFor(organizationId: string, scopes = ["sms:send", "messages:read", "balance:read", "sender_ids:read"]) {
  const k = generateApiKey();
  await db.apiKey.create({ data: { organizationId, name: "test", prefix: k.prefix, keyHash: k.keyHash, scopes } });
  return k.fullKey;
}

export async function balanceOf(organizationId: string) {
  const w = await db.wallet.findUniqueOrThrow({ where: { organizationId } });
  return Number(w.balance);
}
