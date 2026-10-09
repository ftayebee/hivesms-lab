import "server-only";
import type { Decimal } from "decimal.js";
import type { SmsType } from "@/generated/prisma/enums";
import type { TenantContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { isLaravelApiError } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import type { SegmentationRules } from "@/lib/sms-segments";
import { getOrganizationPlan } from "@/services/billing/pricing";
import { getBalance } from "@/services/billing/wallet";
import { getSmsPolicy } from "@/services/settings";
import { listTemplates } from "@/features/templates/service";
import * as viaLaravel from "./laravel";

/**
 * Data of the send page (SMS composer). Settings, rates, balance and the draft come from Laravel
 * when the `campaigns` feature is switched, otherwise from Prisma. Groups, approved sender IDs and
 * templates follow their own features' switches.
 */
export interface ComposerPageConfig {
  segmentation: SegmentationRules;
  promotionalQuietHours: { start: number; end: number } | null;
  promotionalOptOutText: string;
  rates: { transactionalMasking: number; transactionalNonMasking: number; promotionalMasking: number; promotionalNonMasking: number };
  balance: Decimal;
}

export async function loadComposerConfig(ctx: TenantContext): Promise<ComposerPageConfig> {
  if (laravelEnabled("campaigns")) {
    const c = await viaLaravel.composerConfig();
    return {
      segmentation: c.segmentation,
      promotionalQuietHours: c.promotionalQuietHours,
      promotionalOptOutText: c.promotionalOptOutText,
      rates: {
        transactionalMasking: Number(c.rates.transactionalMasking),
        transactionalNonMasking: Number(c.rates.transactionalNonMasking),
        promotionalMasking: Number(c.rates.promotionalMasking),
        promotionalNonMasking: Number(c.rates.promotionalNonMasking),
      },
      balance: c.balance,
    };
  }
  const [policy, plan, balance] = await Promise.all([getSmsPolicy(), getOrganizationPlan(ctx.organizationId), getBalance(ctx.organizationId)]);
  return {
    segmentation: policy.segmentation,
    promotionalQuietHours: policy.promotionalQuietHours,
    promotionalOptOutText: policy.promotionalOptOutText,
    rates: {
      transactionalMasking: Number(plan.transactionalMasking),
      transactionalNonMasking: Number(plan.transactionalNonMasking),
      promotionalMasking: Number(plan.promotionalMasking),
      promotionalNonMasking: Number(plan.promotionalNonMasking),
    },
    balance,
  };
}

/** Templates offered in the composer, by name. */
export async function composerTemplates(ctx: TenantContext): Promise<Array<{ id: string; name: string; body: string; smsType: SmsType }>> {
  if (laravelEnabled("templates")) {
    try {
      const rows = await listTemplates(ctx);
      return rows.map((t) => ({ id: t.id, name: t.name, body: t.body, smsType: t.smsType })).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      // Members without templates:read simply get no templates to pick from.
      if (isLaravelApiError(err) && err.kind === "forbidden") return [];
      throw err;
    }
  }
  return db.template.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, body: true, smsType: true } });
}

export interface ComposerDraft {
  id: string;
  name: string;
  smsType: SmsType;
  senderValue: string;
  templateId: string | null;
  message: string;
  audience: { groupIds?: string[]; numbers?: string[] };
  scheduledAt: Date | null;
}

/** A DRAFT campaign of this organization to edit, or null. */
export async function loadDraft(ctx: TenantContext, id: string): Promise<ComposerDraft | null> {
  if (laravelEnabled("campaigns")) return viaLaravel.draftForComposer(id);
  const d = await db.campaign.findFirst({ where: { id, organizationId: ctx.organizationId, status: "DRAFT", deletedAt: null } });
  return d ? { ...d, audience: d.audience as ComposerDraft["audience"] } : null;
}
