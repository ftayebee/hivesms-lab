/**
 * EXAMPLE pricing used to seed the database and as a fallback when the database is not
 * reachable (e.g. during a static build). These are not real commercial rates.
 * The live source of truth is the `pricing_plans` / `credit_packages` tables, editable in
 * Admin → Pricing (every change is audited).
 */
export interface PlanConfig {
  key: string;
  name: string;
  description: string;
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
  sortOrder: number;
}

export const defaultPlans: PlanConfig[] = [
  {
    key: "starter",
    name: "Starter",
    description: "For small teams sending notifications and occasional campaigns.",
    minRechargeAmount: 500,
    transactionalNonMasking: 0.4,
    transactionalMasking: 0.6,
    promotionalNonMasking: 0.4,
    promotionalMasking: 0.6,
    senderIdFee: 0,
    features: [
      "Dashboard and REST API",
      "Contacts, groups and templates",
      "Delivery reports",
      "Email support",
    ],
    isCustom: false,
    isDefault: true,
    highlighted: false,
    sortOrder: 1,
  },
  {
    key: "business",
    name: "Business",
    description: "For growing businesses with regular campaigns and OTP traffic.",
    minRechargeAmount: 10000,
    transactionalNonMasking: 0.35,
    transactionalMasking: 0.55,
    promotionalNonMasking: 0.35,
    promotionalMasking: 0.55,
    senderIdFee: 0,
    features: [
      "Everything in Starter",
      "Team roles and permissions",
      "Webhooks for delivery reports",
      "Priority ticket handling",
    ],
    isCustom: false,
    isDefault: false,
    highlighted: true,
    sortOrder: 2,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "For high-volume senders that need custom terms and routing.",
    minRechargeAmount: 100000,
    transactionalNonMasking: 0.3,
    transactionalMasking: 0.5,
    promotionalNonMasking: 0.3,
    promotionalMasking: 0.5,
    senderIdFee: 0,
    features: [
      "Everything in Business",
      "Custom rates and limits",
      "Invoice billing on request",
      "Named account contact",
    ],
    isCustom: true,
    isDefault: false,
    highlighted: false,
    sortOrder: 3,
  },
];

export const defaultCreditPackages = [
  { name: "BDT 500", amount: 500, bonusPercent: 0, sortOrder: 1 },
  { name: "BDT 2,000", amount: 2000, bonusPercent: 0, sortOrder: 2 },
  { name: "BDT 5,000", amount: 5000, bonusPercent: 2, sortOrder: 3 },
  { name: "BDT 10,000", amount: 10000, bonusPercent: 3, sortOrder: 4 },
  { name: "BDT 25,000", amount: 25000, bonusPercent: 5, sortOrder: 5 },
];

/** Billing policy defaults (admin-overridable). */
export const defaultBillingPolicy = {
  /** VAT percentage applied to top-ups. Confirm the applicable rate with your tax advisor. */
  vatRatePercent: 15,
  /** Whether listed SMS rates exclude VAT. */
  pricesExcludeVat: true,
  /** Minimum custom top-up amount (BDT) when no package is selected. */
  minimumTopUp: 500,
  /** Maximum single top-up amount (BDT) via online gateways. */
  maximumTopUp: 500000,
  /** Balance validity in months; null = does not expire. */
  balanceValidityMonths: 12 as number | null,
  /** Invoice number prefix. */
  invoicePrefix: "INV",
};

export type BillingPolicy = typeof defaultBillingPolicy;
