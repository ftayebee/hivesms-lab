import {
  BadgeCheck,
  BarChart3,
  BookUser,
  CalendarClock,
  Code2,
  FileSpreadsheet,
  Globe2,
  KeyRound,
  Languages,
  LayoutTemplate,
  ListChecks,
  MailX,
  Megaphone,
  Receipt,
  ScrollText,
  ShieldCheck,
  Tags,
  Users,
  Wallet,
  Webhook,
  Zap,
  LifeBuoy,
  Bell,
  Gauge,
} from "lucide-react";
import { CtaBand, FeatureGrid, JsonLd, PageHero, Section, SectionHeading } from "@/components/marketing/blocks";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Features",
  description: "Bulk campaigns, transactional API, sender IDs, contacts, scheduling, delivery reports, analytics, templates, team roles, BDT billing and anti-abuse safeguards.",
  path: "/features",
});

const groups = [
  {
    id: "messaging",
    title: "Messaging",
    description: "Every way your business needs to send.",
    items: [
      { icon: Megaphone, title: "Bulk campaigns", body: "Build a campaign from groups or pasted numbers, preview cost, and send now or later.", href: "/bulk-sms" },
      { icon: Zap, title: "Transactional SMS", body: "OTPs, confirmations and alerts sent individually through the API.", href: "/transactional-sms" },
      { icon: Megaphone, title: "Promotional SMS", body: "Offers to opted-in customers with automatic opt-out filtering and quiet hours.", href: "/promotional-sms" },
      { icon: Languages, title: "Bangla and Unicode", body: "Automatic encoding detection with live character and segment counts." },
      { icon: LayoutTemplate, title: "Templates and variables", body: "Reusable messages with {{name}}, {{company}} and custom field variables." },
      { icon: CalendarClock, title: "Scheduling", body: "Pick a date and time in Asia/Dhaka. Pause or cancel before sending starts." },
    ],
  },
  {
    id: "audience",
    title: "Contacts and audience",
    description: "Keep your lists clean and your consent records complete.",
    items: [
      { icon: BookUser, title: "Contact management", body: "Add, edit and search contacts with names, emails, companies and custom fields." },
      { icon: FileSpreadsheet, title: "CSV import and export", body: "Import with validation for Bangladeshi numbers and duplicate detection. Export safely." },
      { icon: Tags, title: "Groups and tags", body: "Segment your audience with groups for campaigns and tags for filtering." },
      { icon: MailX, title: "Suppression list", body: "Opted-out numbers are skipped automatically for promotional sends." },
    ],
  },
  {
    id: "developers",
    title: "Developers",
    description: "An API that behaves predictably under retries and failures.",
    items: [
      { icon: Code2, title: "REST API v1", body: "JSON over HTTPS, consistent response envelope and documented error codes.", href: "/sms-api" },
      { icon: KeyRound, title: "Scoped API keys", body: "Per-key scopes, optional IP allowlist and expiry. Keys are shown once and stored hashed." },
      { icon: Webhook, title: "Signed webhooks", body: "Delivery reports pushed to your endpoint with an HMAC signature and retries." },
      { icon: Gauge, title: "Rate-limit headers", body: "Every response tells you your remaining quota and when it resets." },
    ],
  },
  {
    id: "insight",
    title: "Reporting",
    description: "See exactly what happened to every message.",
    items: [
      { icon: ListChecks, title: "Delivery reports", body: "Per-message status, timestamps and failure reasons as reported by the provider." },
      { icon: BarChart3, title: "Analytics", body: "Volume, delivery rate, spend and operator breakdown with date filters." },
      { icon: FileSpreadsheet, title: "CSV reports", body: "Download filtered message logs for your own analysis or records." },
      { icon: Bell, title: "Notifications", body: "In-app and email alerts for completed campaigns, payments and low balance." },
    ],
  },
  {
    id: "account",
    title: "Account, billing and security",
    description: "Built for organizations with more than one person.",
    items: [
      { icon: Users, title: "Team roles", body: "Owner, Admin, Manager, Developer and Viewer roles with configurable permissions." },
      { icon: Wallet, title: "BDT wallet", body: "Top up in BDT and pay per segment. Every charge and refund is in the ledger." },
      { icon: Receipt, title: "Invoices with VAT", body: "Downloadable invoices with VAT shown separately for your accounts team." },
      { icon: BadgeCheck, title: "Sender ID requests", body: "Submit documents and follow approval status. Approval depends on the provider and operators." },
      { icon: ScrollText, title: "Audit logs", body: "Sign-ins, key changes, sends and permission changes are recorded." },
      { icon: ShieldCheck, title: "Anti-abuse controls", body: "Sending limits, content screening and campaign review for new accounts." },
      { icon: Globe2, title: "Bangladesh time", body: "Schedules, reports and invoices use Asia/Dhaka." },
      { icon: LifeBuoy, title: "Support tickets", body: "Raise tickets from the dashboard and follow their status." },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Features", path: "/features" }])} />
      <PageHero
        eyebrow="Features"
        title="A complete SMS platform, not just a sending form"
        description="Campaigns, APIs, contacts, reporting, billing and team controls in one place, with the safeguards a serious sender needs."
        primary={{ label: "Get started", href: "/register" }}
        secondary={{ label: "View pricing", href: "/pricing" }}
      />
      <nav aria-label="Feature sections" className="sticky top-16 z-30 border-b border-border bg-background/90 backdrop-blur">
        <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2 sm:px-6 lg:px-8">
          {groups.map((g) => (
            <li key={g.id}>
              <a href={`#${g.id}`} className="block whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
                {g.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {groups.map((g, i) => (
        <Section key={g.id} id={g.id} tone={i % 2 ? "surface" : "default"} labelledBy={`${g.id}-h`} className="scroll-mt-28">
          <SectionHeading id={`${g.id}-h`} title={g.title} description={g.description} />
          <div className="mt-10">
            <FeatureGrid items={g.items} columns={g.items.length === 4 ? 4 : g.items.length === 8 ? 4 : 3} />
          </div>
        </Section>
      ))}
      <CtaBand title="Ready to try it?" description="Create an account in minutes. You only pay for the messages you send." primary={{ label: "Get started", href: "/register" }} secondary={{ label: "Contact sales", href: "/contact" }} />
    </>
  );
}
