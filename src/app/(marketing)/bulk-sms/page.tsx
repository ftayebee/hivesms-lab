import Link from "next/link";
import { CalendarClock, FileSpreadsheet, ListChecks, MailX, Tags, Users2, ArrowRight } from "lucide-react";
import { CheckList, CtaBand, FaqList, FeatureGrid, FlowSteps, JsonLd, PageHero, Section, SectionHeading } from "@/components/marketing/blocks";
import { StatusBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Bulk SMS service in Bangladesh",
  description: "Send bulk SMS campaigns to your contact groups in Bangladesh with cost preview, scheduling, opt-out filtering and delivery reports.",
  path: "/bulk-sms",
});

const useCases = [
  { t: "Customer announcements", b: "New branches, holiday hours, policy updates." },
  { t: "Seasonal promotions", b: "Eid, Pohela Boishakh and year-end offers to opted-in customers." },
  { t: "Institution notices", b: "School closures, exam schedules and fee reminders." },
  { t: "Event reminders", b: "Health camps, seminars and community meetings." },
  { t: "Service alerts", b: "Planned maintenance or outage notices." },
  { t: "Internal staff updates", b: "Shift changes and field team coordination." },
];

const faq = [
  { q: "How many numbers can I send to at once?", a: "A campaign can include large audiences (the default limit is 200,000 recipients per campaign, configurable per account). Daily and monthly sending limits apply to every account and can be raised by support as your sending history grows." },
  { q: "Can I personalise bulk messages?", a: "Yes. Use variables such as {{name}}, {{company}} or any custom field from your contacts. Personalised messages may differ in length, so the composer shows an estimate and the final charge is based on each actual message." },
  { q: "What happens to opted-out numbers?", a: "For promotional campaigns, numbers on your suppression list or marked as opted out are skipped automatically and are not charged. The campaign report shows how many were skipped and why." },
  { q: "When am I charged?", a: "When the campaign starts sending. Messages that fail are refunded according to the refund policy." },
];

export default function BulkSmsPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Bulk SMS", path: "/bulk-sms" }])} />
      <PageHero
        eyebrow="Bulk SMS"
        title="Reach thousands of customers with one campaign"
        description="Choose your audience, write once, preview the exact cost, and send now or on schedule. Track delivery for every recipient."
        primary={{ label: "Start a campaign", href: "/register" }}
        secondary={{ label: "See pricing", href: "/pricing" }}
      >
        <div className="rounded-xl border border-border bg-card p-5 shadow-lg" aria-label="Example campaign summary" role="img">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Eid offer, opted-in customers</p>
            <StatusBadge status="PROCESSING" label="Sending" />
          </div>
          <Progress className="mt-4" value={5120} max={8200} label="Campaign progress" />
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            {[
              ["Recipients", "8,200"],
              ["Skipped (opted out)", "143"],
              ["Segments each", "2"],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md bg-surface p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 font-semibold tabular">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Example campaign for illustration.</p>
        </div>
      </PageHero>

      <Section labelledBy="what-h">
        <div className="grid gap-12 lg:grid-cols-2 [&>*]:min-w-0">
          <SectionHeading id="what-h" title="What is bulk SMS?" description="Bulk SMS means sending the same (or a personalised) message to many recipients at once. It is the most direct way to reach customers in Bangladesh: almost every adult has a mobile phone, and SMS needs no app or data connection." />
          <div className="rounded-lg border border-border bg-surface p-6">
            <h3 className="text-[15px] font-semibold">Good bulk SMS practice</h3>
            <CheckList
              className="mt-4"
              items={[
                "Only message people who agreed to hear from you, and honour opt-outs.",
                "Identify your business in the sender ID or message.",
                "Keep promotional messages within allowed hours.",
                "Keep messages short. Bangla text uses more segments than English.",
                "Test with your own number before sending to everyone.",
              ]}
            />
          </div>
        </div>
      </Section>

      <Section tone="surface" labelledBy="uses-h">
        <SectionHeading id="uses-h" title="What businesses use it for" />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((u) => (
            <li key={u.t} className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-[15px] font-semibold">{u.t}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{u.b}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section labelledBy="flow-h">
        <SectionHeading id="flow-h" title="How a campaign works" description="Six steps from idea to delivery report. You can save a draft at any point." />
        <div className="mt-10">
          <FlowSteps
            steps={[
              { title: "Create campaign", body: "Name it and choose transactional or promotional." },
              { title: "Select contacts", body: "Pick groups, paste numbers or import a CSV." },
              { title: "Write message", body: "Use a template or write new, with live segment count." },
              { title: "Review", body: "Check recipients, skipped numbers and total cost." },
              { title: "Send or schedule", body: "Send now or pick a time in Asia/Dhaka." },
              { title: "Track delivery", body: "Follow sent, delivered and failed in real time." },
            ]}
            note="Campaigns from new accounts, or above the review threshold, are checked by our team before sending."
          />
        </div>
      </Section>

      <Section tone="surface" labelledBy="feat-h">
        <SectionHeading id="feat-h" title="Built for large, clean sends" />
        <div className="mt-10">
          <FeatureGrid
            items={[
              { icon: FileSpreadsheet, title: "Contact import", body: "Upload CSV files. Numbers are validated and normalised to +880 format, duplicates removed." },
              { icon: Tags, title: "Groups and tags", body: "Organise contacts into groups for campaigns and tags for filtering." },
              { icon: MailX, title: "Automatic opt-out filtering", body: "Suppressed numbers are skipped and not charged." },
              { icon: CalendarClock, title: "Scheduling", body: "Schedule for later, then pause or cancel before sending starts." },
              { icon: ListChecks, title: "Delivery reports", body: "Per-recipient status, failure reasons and CSV export." },
              { icon: Users2, title: "Team approval flow", body: "Managers build campaigns; permissions control who can send." },
            ]}
          />
        </div>
      </Section>

      <Section labelledBy="pricing-h">
        <div className="flex flex-col items-start justify-between gap-6 rounded-xl border border-border bg-card p-8 md:flex-row md:items-center">
          <div>
            <h2 id="pricing-h" className="text-2xl font-semibold tracking-tight">
              Pay per segment, see the total before you send
            </h2>
            <p className="mt-2 max-w-xl text-muted-foreground">Rates depend on message type and sender type. Use the calculator to estimate a monthly budget.</p>
          </div>
          <Button asChild size="lg" variant="secondary">
            <Link href="/pricing#calculator">
              Open the calculator <ArrowRight />
            </Link>
          </Button>
        </div>
      </Section>

      <Section tone="surface" labelledBy="faq-h">
        <SectionHeading id="faq-h" title="Bulk SMS questions" />
        <div className="mt-8 max-w-3xl">
          <FaqList items={faq} />
        </div>
      </Section>

      <CtaBand title="Send your first campaign" description="Import your contacts and send a test to yourself in a few minutes." primary={{ label: "Create account", href: "/register" }} secondary={{ label: "Talk to sales", href: "/contact" }} />
    </>
  );
}
