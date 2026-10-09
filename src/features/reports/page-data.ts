import "server-only";
import type { z } from "zod";
import type { TenantContext } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { laravelEnabled } from "@/lib/laravel/flags";
import { listMessages, toMessageFilters, type reportFiltersSchema } from "./messages";
import { getDailySeries, getFailureReasons, getOperatorBreakdown, getStatusTotals } from "./queries";
import type { DateRange } from "./range";
import * as viaLaravel from "./laravel";

/** Everything the reports page renders, from one backend (LARAVEL_FEATURES `reports` or Prisma). */
export async function loadReportsPage(
  ctx: TenantContext,
  range: DateRange,
  rawFilters: z.infer<typeof reportFiltersSchema>,
  page: number,
) {
  if (laravelEnabled("reports")) {
    const [d, messages, options] = await Promise.all([viaLaravel.delivery(range, rawFilters), viaLaravel.listMessages(range, rawFilters, page), viaLaravel.filterOptions()]);
    return { totals: d.totals, daily: d.daily, operators: d.operators, failures: d.failures, messages, campaigns: options.campaigns, senders: options.senders };
  }
  const filters = toMessageFilters(rawFilters);
  const [totals, daily, operators, failures, messages, campaigns, senders] = await Promise.all([
    getStatusTotals(ctx, range, filters),
    getDailySeries(ctx, range, filters),
    getOperatorBreakdown(ctx, range, filters),
    getFailureReasons(ctx, range, filters),
    listMessages(ctx, range, filters, page),
    db.campaign.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null, startedAt: { not: null } }, orderBy: { startedAt: "desc" }, take: 100, select: { id: true, name: true } }),
    db.message.findMany({ where: { organizationId: ctx.organizationId }, distinct: ["senderValue"], select: { senderValue: true }, take: 50 }),
  ]);
  return { totals, daily, operators, failures, messages, campaigns, senders };
}
