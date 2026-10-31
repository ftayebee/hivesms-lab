import type { PricingPlan } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { jsonStringArray } from "@/lib/utils";
import { defaultPlans, defaultCreditPackages, defaultBillingPolicy } from "@/config/pricing";
import { getBillingPolicy } from "@/services/settings";
import { unstable_rethrow } from "next/navigation";
import { laravelData } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";

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
    features: jsonStringArray(p.features),
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

/**
 * Everything the public pricing page renders. With LARAVEL_FEATURES `public` it comes from
 * GET /public/pricing; either way the page falls back to the config defaults when the source is
 * unreachable (e.g. during a container image build).
 */
export async function loadPublicPricing() {
  if (laravelEnabled("public")) {
    try {
      const d = await laravelData<{
        plans: Array<Omit<PublicPlan, "minRechargeAmount" | "transactionalNonMasking" | "transactionalMasking" | "promotionalNonMasking" | "promotionalMasking" | "senderIdFee" | "features"> & Record<"minRechargeAmount" | "transactionalNonMasking" | "transactionalMasking" | "promotionalNonMasking" | "promotionalMasking" | "senderIdFee", string> & { features: unknown }>;
        packages: Array<{ id: string | null; name: string; amount: string; bonusPercent: string; description: string | null }>;
        vatRatePercent: number;
        minimumTopUp: number;
        balanceValidityMonths: number | null;
      }>("public/pricing", undefined, { auth: false });
      if (d.plans.length) {
        return {
          plans: d.plans.map((p) => ({
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
            features: jsonStringArray(p.features),
            isCustom: p.isCustom,
            isDefault: p.isDefault,
            highlighted: p.highlighted,
          })),
          source: "database" as const,
          packages: d.packages.length
            ? d.packages.map((p) => ({ id: p.id, name: p.name, amount: Number(p.amount), bonusPercent: Number(p.bonusPercent), description: p.description }))
            : defaultCreditPackages.map((p) => ({ ...p, id: null as string | null, description: null as string | null })),
          policy: { vatRatePercent: d.vatRatePercent, minimumTopUp: d.minimumTopUp, balanceValidityMonths: d.balanceValidityMonths },
        };
      }
    } catch (err) {
      unstable_rethrow(err);
      logger.warn({ err: (err as Error).message }, "public pricing unavailable from the API, using config defaults");
    }
    return {
      plans: defaultPlans.map((p) => ({ ...p, id: null })),
      source: "defaults" as const,
      packages: defaultCreditPackages.map((p) => ({ ...p, id: null as string | null, description: null as string | null })),
      policy: { vatRatePercent: defaultBillingPolicy.vatRatePercent, minimumTopUp: defaultBillingPolicy.minimumTopUp, balanceValidityMonths: defaultBillingPolicy.balanceValidityMonths },
    };
  }
  const [{ plans, source }, packages, policy] = await Promise.all([getPublicPlans(), getActivePackages(), getBillingPolicy()]);
  return { plans, source, packages, policy: { vatRatePercent: policy.vatRatePercent, minimumTopUp: policy.minimumTopUp, balanceValidityMonths: policy.balanceValidityMonths } };
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
