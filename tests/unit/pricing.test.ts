import { describe, expect, it } from "vitest";
import { estimateMonthly, messageCost, rateFor, suggestPlan, topUpBreakdown } from "@/lib/pricing";

const plan = { transactionalNonMasking: 0.35, transactionalMasking: 0.55, promotionalNonMasking: 0.3, promotionalMasking: 0.5 };

describe("pricing", () => {
  it("picks the rate by message and sender type", () => {
    expect(rateFor(plan, "TRANSACTIONAL", "NON_MASKING").toNumber()).toBe(0.35);
    expect(rateFor(plan, "TRANSACTIONAL", "MASKING").toNumber()).toBe(0.55);
    expect(rateFor(plan, "PROMOTIONAL", "NON_MASKING").toNumber()).toBe(0.3);
    expect(rateFor(plan, "PROMOTIONAL", "MASKING").toNumber()).toBe(0.5);
  });

  it("multiplies segments by recipients by rate without float drift", () => {
    expect(messageCost(2, 1000, "0.35").toString()).toBe("700");
    expect(messageCost(3, 7, "0.1").toString()).toBe("2.1"); // 0.1 * 21 would drift as a float
  });

  it("adds VAT on top of the top-up and credits bonus to the wallet", () => {
    const b = topUpBreakdown(5000, 15, 2);
    expect(b.subtotal.toString()).toBe("5000");
    expect(b.vatAmount.toString()).toBe("750");
    expect(b.total.toString()).toBe("5750");
    expect(b.bonus.toString()).toBe("100");
    expect(b.creditAmount.toString()).toBe("5100");
  });

  it("rounds VAT to poisha", () => {
    expect(topUpBreakdown(333.33, 15).vatAmount.toString()).toBe("50");
    expect(topUpBreakdown(100.01, 15).vatAmount.toString()).toBe("15");
  });

  it("estimates a monthly cost including VAT", () => {
    const r = estimateMonthly(plan, { monthlyVolume: 10_000, smsType: "TRANSACTIONAL", senderType: "NON_MASKING", segmentsPerMessage: 2, country: "BD" }, 15);
    expect(r.segmentsTotal).toBe(20_000);
    expect(r.smsCost.toString()).toBe("7000");
    expect(r.totalWithVat.toString()).toBe("8050");
  });

  it("suggests the largest non-custom plan whose minimum the spend reaches", () => {
    const plans = [
      { key: "starter", minRechargeAmount: 500, isCustom: false, ...plan },
      { key: "business", minRechargeAmount: 10000, isCustom: false, ...plan, transactionalNonMasking: 0.33 },
      { key: "enterprise", minRechargeAmount: 100000, isCustom: true, ...plan },
    ];
    expect(suggestPlan(plans, 1000, "TRANSACTIONAL", "NON_MASKING")?.key).toBe("starter");
    expect(suggestPlan(plans, 100_000, "TRANSACTIONAL", "NON_MASKING")?.key).toBe("business");
    expect(suggestPlan(plans, 10_000_000, "TRANSACTIONAL", "NON_MASKING")?.key).toBe("business");
  });
});
