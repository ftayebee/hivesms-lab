import type { Messages } from "@/i18n";

export interface NavLink {
  labelKey?: keyof Messages["nav"];
  label?: string;
  href: string;
  description?: string;
}

export interface NavGroup {
  labelKey: keyof Messages["nav"];
  href?: string;
  items?: NavLink[];
}

export const solutionSlugs = ["ecommerce", "education", "healthcare", "banking-fintech", "retail", "logistics", "government-ngo", "software"] as const;

export const mainNav: NavGroup[] = [
  {
    labelKey: "products",
    items: [
      { labelKey: "bulkSms", href: "/bulk-sms", description: "Campaigns to thousands of contacts" },
      { labelKey: "transactionalSms", href: "/transactional-sms", description: "OTPs, alerts and confirmations" },
      { labelKey: "promotionalSms", href: "/promotional-sms", description: "Offers to opted-in customers" },
      { labelKey: "features", href: "/features", description: "Everything in the platform" },
    ],
  },
  {
    labelKey: "solutions",
    href: "/solutions",
    items: [
      { label: "E-commerce", href: "/solutions/ecommerce" },
      { label: "Education", href: "/solutions/education" },
      { label: "Healthcare", href: "/solutions/healthcare" },
      { label: "Banking & fintech", href: "/solutions/banking-fintech" },
      { label: "Retail", href: "/solutions/retail" },
      { label: "Logistics", href: "/solutions/logistics" },
      { label: "Government & NGO", href: "/solutions/government-ngo" },
      { label: "Software companies", href: "/solutions/software" },
    ],
  },
  {
    labelKey: "developers",
    items: [
      { labelKey: "smsApi", href: "/sms-api", description: "REST API overview and examples" },
      { labelKey: "documentation", href: "/docs", description: "Guides and quick start" },
      { labelKey: "apiReference", href: "/docs/api-reference", description: "Every endpoint and field" },
      { labelKey: "changelog", href: "/docs/changelog", description: "What changed and when" },
    ],
  },
  { labelKey: "pricing", href: "/pricing" },
  {
    labelKey: "resources",
    items: [
      { labelKey: "faq", href: "/faq" },
      { labelKey: "about", href: "/about" },
      { label: "Report abuse", href: "/report-abuse" },
    ],
  },
  { labelKey: "contact", href: "/contact" },
];

export const footerNav = [
  {
    title: "Products",
    links: [
      { label: "Bulk SMS", href: "/bulk-sms" },
      { label: "Transactional SMS", href: "/transactional-sms" },
      { label: "Promotional SMS", href: "/promotional-sms" },
      { label: "Features", href: "/features" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "SMS API", href: "/sms-api" },
      { label: "Documentation", href: "/docs" },
      { label: "Quick start", href: "/docs/quick-start" },
      { label: "Error codes", href: "/docs/error-codes" },
      { label: "Changelog", href: "/docs/changelog" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About us", href: "/about" },
      { label: "Solutions", href: "/solutions" },
      { label: "Contact", href: "/contact" },
      { label: "FAQ", href: "/faq" },
      { label: "Report abuse", href: "/report-abuse" },
    ],
  },
  {
    title: "Legal",
    links: [
      { label: "Terms & Conditions", href: "/terms" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Refund Policy", href: "/refund-policy" },
    ],
  },
];
