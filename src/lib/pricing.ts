import { Decimal } from "decimal.js";

/**
 * Pure pricing math shared by the public calculator, the composer preview and the server-side
 * charge. The server is authoritative: it recomputes with database rates at send time.
 *
 *   cost = segments per message × recipients × rate(smsType, senderType)
 *
 * Rates are per SMS segment in BDT and exclude VAT (VAT is applied on top-ups).
 */
export type SmsTypeKey = "TRANSACTIONAL" | "PROMOTIONAL";
export type SenderTypeKey = "MASKING" | "NON_MASKING";

export interface PlanRates {
  transactionalNonMasking: number | string | Decimal;
  transactionalMasking: number | string | Decimal;
  promotionalNonMasking: number | string | Decimal;
  promotionalMasking: number | string | Decimal;
}

export function rateFor(plan: PlanRates, smsType: SmsTypeKey, senderType: SenderTypeKey): Decimal {
  const v =
    smsType === "TRANSACTIONAL"
      ? senderType === "MASKING"
        ? plan.transactionalMasking
        : plan.transactionalNonMasking
      : senderType === "MASKING"
        ? plan.promotionalMasking
        : plan.promotionalNonMasking;
  return new Decimal(v.toString());
}

export function messageCost(segments: number, recipients: number, rate: Decimal | number | string): Decimal {
  return new Decimal(rate.toString()).mul(segments).mul(recipients).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export interface TopUpBreakdown {
  subtotal: Decimal;
  vatRate: Decimal;
  vatAmount: Decimal;
  total: Decimal;
  bonus: Decimal;
  creditAmount: Decimal;
}

/**
 * Top-up maths. The wallet is credited with the subtotal plus any package bonus; VAT is charged
 * on the subtotal and is not credited to the wallet.
 */
export function topUpBreakdown(amount: number | string | Decimal, vatRatePercent: number | string | Decimal, bonusPercent: number | string | Decimal = 0): TopUpBreakdown {
  const subtotal = new Decimal(amount.toString()).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vatRate = new Decimal(vatRatePercent.toString());
  const vatAmount = subtotal.mul(vatRate).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const bonus = subtotal.mul(new Decimal(bonusPercent.toString())).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { subtotal, vatRate, vatAmount, total: subtotal.plus(vatAmount), bonus, creditAmount: subtotal.plus(bonus) };
}

export interface CalculatorInput {
  monthlyVolume: number;
  smsType: SmsTypeKey;
  senderType: SenderTypeKey;
  /** Average segments per message (1 for short English, 2+ for long or Bangla text). */
  segmentsPerMessage: number;
  country: "BD";
}

export interface CalculatorResult {
  rate: Decimal;
  smsCost: Decimal;
  vatAmount: Decimal;
  totalWithVat: Decimal;
  segmentsTotal: number;
}

/** Monthly estimate for the public pricing calculator. */
export function estimateMonthly(plan: PlanRates, input: CalculatorInput, vatRatePercent: number): CalculatorResult {
  const rate = rateFor(plan, input.smsType, input.senderType);
  const segmentsTotal = Math.max(0, Math.round(input.monthlyVolume)) * Math.max(1, Math.round(input.segmentsPerMessage));
  const smsCost = rate.mul(segmentsTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const vatAmount = smsCost.mul(vatRatePercent).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return { rate, smsCost, vatAmount, totalWithVat: smsCost.plus(vatAmount), segmentsTotal };
}

/**
 * Chooses the plan whose minimum recharge the monthly spend would reach. Custom plans are
 * excluded (they need a sales conversation).
 */
export function suggestPlan<T extends PlanRates & { minRechargeAmount: number | string | Decimal; isCustom: boolean }>(
  plans: T[],
  monthlyVolume: number,
  smsType: SmsTypeKey,
  senderType: SenderTypeKey,
): T | undefined {
  const eligible = plans.filter((p) => !p.isCustom).sort((a, b) => Number(a.minRechargeAmount) - Number(b.minRechargeAmount));
  let chosen = eligible[0];
  for (const p of eligible) {
    const spend = rateFor(p, smsType, senderType).mul(monthlyVolume);
    if (spend.gte(new Decimal(p.minRechargeAmount.toString()))) chosen = p;
  }
  return chosen;
}
