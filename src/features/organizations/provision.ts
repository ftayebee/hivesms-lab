import { db, type Tx } from "@/lib/db";
import { randomAlphanumeric } from "@/lib/crypto";
import { PERMISSIONS, ROLE_ORDER, SYSTEM_ROLES } from "@/lib/auth/permissions";

/**
 * Organization provisioning: permission catalogue, per-organization system roles, owner
 * membership and wallet. Used by registration, the seed and admin tooling.
 */
export async function ensurePermissionCatalogue(client: Tx | typeof db = db) {
  for (const [key, def] of Object.entries(PERMISSIONS)) {
    await client.permission.upsert({
      where: { key },
      create: { key, group: def.group, description: def.description },
      update: { group: def.group, description: def.description },
    });
  }
}

export function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${randomAlphanumeric(5)}`;
}

export async function createRolesForOrganization(tx: Tx, organizationId: string) {
  const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
  const roles: Record<string, string> = {};
  for (const key of ROLE_ORDER) {
    const def = SYSTEM_ROLES[key];
    const role = await tx.role.create({
      data: {
        organizationId,
        key,
        name: def.name,
        description: def.description,
        isSystem: true,
        permissions: {
          create: def.permissions.map((p) => ({ permissionId: idByKey.get(p)! })).filter((x) => x.permissionId),
        },
      },
    });
    roles[key] = role.id;
  }
  return roles;
}

export async function createOrganizationWithOwner(
  tx: Tx,
  input: { name: string; ownerUserId: string; industry?: string | null; pricingPlanId?: string | null },
) {
  const org = await tx.organization.create({
    data: {
      name: input.name,
      slug: slugify(input.name),
      industry: input.industry ?? null,
      pricingPlanId: input.pricingPlanId ?? null,
    },
  });
  const roles = await createRolesForOrganization(tx, org.id);
  await tx.organizationMember.create({ data: { organizationId: org.id, userId: input.ownerUserId, roleId: roles.OWNER } });
  await tx.wallet.create({ data: { organizationId: org.id } });
  return { org, roles };
}
