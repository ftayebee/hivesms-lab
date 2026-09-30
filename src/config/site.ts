/**
 * Brand and business configuration.
 *
 * Everything that identifies the operating company lives here so the product can be rebranded
 * without touching components. Contact details are PLACEHOLDERS: replace them (or override at
 * runtime from Admin → Settings → Website content) before going live. Do not publish the
 * placeholder values as if they were real.
 */
export const siteConfig = {
  name: "SMSFlow BD",
  shortName: "SMSFlow",
  legalName: "SMSFlow BD (operating company name - configure)",
  tagline: "SMS infrastructure for businesses in Bangladesh",
  description:
    "Send bulk, transactional and promotional SMS in Bangladesh through a campaign dashboard or a REST API, with delivery reports, BDT billing and team controls.",
  url: process.env.APP_URL ?? "http://localhost:3000",
  locale: "en_BD",
  currency: "BDT",
  timezone: "Asia/Dhaka",
  country: "BD",
  // Placeholder contact details. These are intentionally not real.
  contact: {
    email: "hello@example.com",
    supportEmail: "support@example.com",
    salesEmail: "sales@example.com",
    abuseEmail: "abuse@example.com",
    phone: "+880 1XXX-XXXXXX",
    address: "Company address, Dhaka, Bangladesh (configure)",
    hours: "Sunday to Thursday, 10:00 to 18:00 (Asia/Dhaka)",
  },
  social: {
    facebook: "",
    linkedin: "",
    github: "",
  },
  apiBaseUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/api/v1`,
} as const;

export type SiteConfig = typeof siteConfig;
