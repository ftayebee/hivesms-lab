import type { PricingPlan } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { defaultPlans, defaultCreditPackages } from "@/config/pricing";

/**
 * Pricing plans and packages from the database, with config fallbacks so public pages still
 * render if the database is unreachable (e.g. during a container image build).
 */
export type PublicPlan = {
  id: string | null;
  key: string;
  name: string;
  description: string | null;
  minRechargeAmount: number;
  transactionalNonMasking: number;
  transactionalMasking: number;
  promotionalNonMasking: number;
  promotionalMasking: number;
  senderIdFee: number;
  features: string[];
  isCustom: boolean;
  isDefault: boolean;
  highlighted: boolean;
};

function toPublic(p: PricingPlan): PublicPlan {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    minRechargeAmount: Number(p.minRechargeAmount),
    transactionalNonMasking: Number(p.transactionalNonMasking),
    transactionalMasking: Number(p.transactionalMasking),
    promotionalNonMasking: Number(p.promotionalNonMasking),
    promotionalMasking: Number(p.promotionalMasking),
    senderIdFee: Number(p.senderIdFee),
    features: p.features,
    isCustom: p.isCustom,
    isDefault: p.isDefault,
    highlighted: p.highlighted,
  };
}

export async function getPublicPlans(): Promise<{ plans: PublicPlan[]; source: "database" | "defaults" }> {
  try {
    const rows = await db.pricingPlan.findMany({ where: { active: true, isPublic: true }, orderBy: { sortOrder: "asc" } });
    if (rows.length) return { plans: rows.map(toPublic), source: "database" };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "pricing plans unavailable, using config defaults");
  }
  return { plans: defaultPlans.map((p) => ({ ...p, id: null })), source: "defaults" };
}

export async function getActivePackages() {
  try {
    const rows = await db.creditPackage.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (rows.length) {
      return rows.map((r) => ({ id: r.id as string | null, name: r.name, amount: Number(r.amount), bonusPercent: Number(r.bonusPercent), description: r.description }));
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "credit packages unavailable, using config defaults");
  }
  return defaultCreditPackages.map((p) => ({ ...p, id: null as string | null, description: null as string | null }));
}

/** The plan that prices an organization's messages: its assigned plan, else the default plan. */
export async function getOrganizationPlan(organizationId: string): Promise<PricingPlan> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { pricingPlan: true } });
  if (org?.pricingPlan && org.pricingPlan.active) return org.pricingPlan;
  const fallback =
    (await db.pricingPlan.findFirst({ where: { isDefault: true, active: true } })) ??
    (await db.pricingPlan.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } }));
  if (!fallback) throw new Error("No active pricing plan configured. Seed the database or create a plan in Admin → Pricing.");
  return fallback;
}
