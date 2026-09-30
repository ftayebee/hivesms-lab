import { apiHandler } from "@/lib/api/handler";
import { rateFor } from "@/lib/pricing";
import { getBalance } from "@/services/billing/wallet";
import { getOrganizationPlan } from "@/services/billing/pricing";

/** GET /api/v1/balance: wallet balance and the account's per-segment rates. */
export const GET = apiHandler({ auth: "apiKey", scopes: ["balance:read"] }, async ({ ctx }) => {
  const [balance, plan] = await Promise.all([getBalance(ctx!.organizationId), getOrganizationPlan(ctx!.organizationId)]);
  const r = (t: "TRANSACTIONAL" | "PROMOTIONAL", s: "MASKING" | "NON_MASKING") => rateFor(plan, t, s).toFixed(4);
  return {
    data: {
      balance: balance.toFixed(4),
      currency: "BDT",
      plan: plan.name,
      rates: {
        transactional: { masking: r("TRANSACTIONAL", "MASKING"), non_masking: r("TRANSACTIONAL", "NON_MASKING") },
        promotional: { masking: r("PROMOTIONAL", "MASKING"), non_masking: r("PROMOTIONAL", "NON_MASKING") },
      },
    },
  };
});
