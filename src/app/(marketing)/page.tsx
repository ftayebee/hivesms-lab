import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BadgeCheck,
  BookUser,
  CalendarClock,
  ClipboardCheck,
  Code2,
  FileText,
  GraduationCap,
  HeartPulse,
  Landmark,
  LayoutTemplate,
  ListChecks,
  MailX,
  Megaphone,
  ScrollText,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  Users,
  Zap,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Container, CtaBand, FaqList, FeatureGrid, FlowSteps, JsonLd, Section, SectionHeading } from "@/components/marketing/blocks";
import { HeroPreview } from "@/components/marketing/hero-preview";
import { SegmentPlayground } from "@/components/marketing/segment-playground";
import { ApiCodeBlock } from "@/components/docs/code-block";
import { sendSmsSamples } from "@/content/api-samples";
import { faqs } from "@/content/marketing";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: { absolute: `${siteConfig.name}: Bulk SMS, OTP and SMS API platform for Bangladesh` },
  description:
    "Send bulk, transactional and promotional SMS across Bangladesh from one dashboard or a REST API. Delivery reports, Bangla support, BDT billing and team controls.",
  alternates: { canonical: "/" },
  openGraph: { title: `${siteConfig.name}: SMS platform for Bangladesh`, description: siteConfig.description, url: "/" },
};

const features = [
  { icon: Megaphone, title: "Bulk SMS", body: "Send to thousands of recipients from a guided campaign builder with cost preview.", href: "/bulk-sms" },
  { icon: Zap, title: "Transactional SMS", body: "OTPs, alerts and confirmations sent through the API as your app needs them.", href: "/transactional-sms" },
  { icon: Code2, title: "SMS API", body: "Versioned REST API with scoped keys, idempotency keys and signed webhooks.", href: "/sms-api" },
  { icon: BadgeCheck, title: "Sender ID", body: "Request and manage branded sender IDs. Approval depends on the provider and operators." },
  { icon: BookUser, title: "Contact management", body: "Import CSV files, organise contacts with groups and tags, track consent." },
  { icon: CalendarClock, title: "Scheduling", body: "Schedule campaigns for a date and time in Bangladesh time (Asia/Dhaka)." },
  { icon: ListChecks, title: "Delivery reports", body: "See every message's status and failure reason as provider reports arrive." },
  { icon: BarChart3, title: "Analytics", body: "Track volume, delivery rate, spend and campaign performance over time." },
  { icon: LayoutTemplate, title: "Templates", body: "Save reusable messages with {{name}} style variables for personalisation." },
  { icon: Users, title: "Team management", body: "Invite colleagues with Owner, Admin, Manager, Developer or Viewer roles." },
];

const industries = [
  { icon: ShoppingBag, label: "E-commerce", href: "/solutions/ecommerce" },
  { icon: GraduationCap, label: "Education", href: "/solutions/education" },
  { icon: HeartPulse, label: "Healthcare", href: "/solutions/healthcare" },
  { icon: Store, label: "Retail", href: "/solutions/retail" },
  { icon: Boxes, label: "SaaS", href: "/solutions/software" },
  { icon: Landmark, label: "Finance", href: "/solutions/banking-fintech" },
  { icon: Truck, label: "Logistics", href: "/solutions/logistics" },
];

export default function HomePage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: siteConfig.name,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: siteConfig.description,
          url: siteConfig.url,
          offers: { "@type": "Offer", priceCurrency: "BDT", description: "Pay per SMS segment. See pricing page." },
        }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(55%_60%_at_15%_0%,var(--primary-soft),transparent_70%)]" />
        <Container className="relative grid gap-12 pb-16 pt-12 md:pt-16 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-12 lg:pb-24 [&>*]:min-w-0">
          <div className="max-w-xl">
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl lg:text-[3.25rem] lg:leading-[1.08]">
              Powerful SMS communication for businesses in Bangladesh.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Bulk campaigns, OTPs and alerts from one dashboard or a developer-friendly API, with delivery tracking for every message.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/register">
                  Start Sending SMS <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/sms-api">Explore API</Link>
              </Button>
            </div>
          </div>
          <HeroPreview />
        </Container>
      </section>

      {/* Trust: industries, not fabricated customers */}
      <section aria-labelledby="trust-heading" className="border-y border-border bg-surface py-10">
        <Container className="flex flex-col items-center gap-5 text-center">
          <h2 id="trust-heading" className="text-sm font-medium text-muted-foreground">
            Built for teams that communicate with customers every day.
          </h2>
          <ul className="flex flex-wrap justify-center gap-2">
            {industries.map((i) => (
              <li key={i.label}>
                <Link href={i.href} className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-sm font-medium shadow-xs hover:border-primary/40 hover:text-primary">
                  <i.icon className="size-4 text-muted-foreground" aria-hidden />
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* Features */}
      <Section labelledBy="features-heading">
        <SectionHeading id="features-heading" eyebrow="Platform" title="Everything you need to send, track and manage SMS" description="One platform for marketing teams, operations staff and developers, with pricing and delivery information visible at every step." />
        <div className="mt-12">
          <FeatureGrid items={features.slice(0, 9)} />
          <div className="mt-px flex flex-col justify-between gap-4 rounded-b-lg border border-t-0 border-border bg-card p-6 sm:flex-row sm:items-center">
            <div className="flex gap-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                <Users className="size-[18px]" aria-hidden />
              </span>
              <div>
                <h3 className="text-[15px] font-semibold">{features[9].title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{features[9].body}</p>
              </div>
            </div>
            <Button asChild variant="secondary">
              <Link href="/features">See all features</Link>
            </Button>
          </div>
        </div>
      </Section>

      {/* Two ways to send */}
      <Section tone="surface" labelledBy="api-heading">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 id="api-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">
              A dashboard for your team. An API for your code.
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Marketing teams build campaigns without writing code. Developers send OTPs and notifications with a single authenticated request.
            </p>
            <ul className="mt-8 space-y-5">
              {[
                { icon: ShieldCheck, t: "Scoped API keys", b: "Keys are shown once, stored hashed, and limited to the scopes you choose. Optional IP allowlists." },
                { icon: ClipboardCheck, t: "Safe retries", b: "Send an Idempotency-Key and a retried request never sends the message twice." },
                { icon: FileText, t: "Signed webhooks", b: "Receive delivery reports on your endpoint, signed with HMAC-SHA256 so you can verify them." },
              ].map((x) => (
                <li key={x.t} className="flex gap-4">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-card text-primary shadow-xs ring-1 ring-border">
                    <x.icon className="size-[18px]" aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-[15px] font-semibold">{x.t}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{x.b}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Button asChild variant="link" className="mt-6">
              <Link href="/docs/quick-start">
                Read the quick start <ArrowRight />
              </Link>
            </Button>
          </div>
          <ApiCodeBlock samples={sendSmsSamples} title="POST /api/v1/sms/send" />
        </div>
      </Section>

      {/* Cost transparency */}
      <Section labelledBy="cost-heading">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center [&>*]:min-w-0">
          <div>
            <h2 id="cost-heading" className="text-3xl font-semibold tracking-tight md:text-4xl">
              Know the cost before you press send
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Bangla and long messages use more segments, and each segment is billed. Our composer shows encoding, segments and cost as you type, so there are no surprises on your invoice.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">Try it: switch between the examples or type your own message.</p>
          </div>
          <SegmentPlayground />
        </div>
      </Section>

      {/* Workflow */}
      <Section tone="surface" labelledBy="how-heading">
        <SectionHeading id="how-heading" title="From sign-up to first message" description="Most teams send a first test message on the day they sign up. Branded sender IDs take longer because they need approval." />
        <div className="mt-10">
          <FlowSteps
            steps={[
              { title: "Create an account", body: "Register with your work email and verify it." },
              { title: "Add balance", body: "Top up your BDT wallet. VAT is shown separately." },
              { title: "Choose a sender", body: "Use the shared number, or request a branded sender ID." },
              { title: "Send", body: "Launch a campaign or call the API." },
              { title: "Track", body: "Follow delivery status per message and per campaign." },
            ]}
          />
        </div>
      </Section>

      {/* Responsible messaging */}
      <Section labelledBy="compliance-heading">
        <SectionHeading id="compliance-heading" eyebrow="Responsible messaging" title="Safeguards that protect your sender reputation" description="Messages that people did not ask for hurt deliverability for everyone. The platform builds good practice into the workflow." />
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: MailX, t: "Opt-out handling", b: "Suppressed numbers are skipped automatically for promotional messages." },
            { icon: ClipboardCheck, t: "Consent tracking", b: "Record consent status and source for each contact." },
            { icon: ShieldCheck, t: "Campaign review", b: "New accounts and large sends can be reviewed before they go out." },
            { icon: ScrollText, t: "Audit logs", b: "Sign-ins, key changes, sends and admin actions are logged." },
          ].map((x, i) => (
            <div key={x.t} className={i === 0 ? "rounded-lg border border-primary/20 bg-primary-soft p-5" : "rounded-lg border border-border bg-card p-5"}>
              <x.icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-[15px] font-semibold">{x.t}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{x.b}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* FAQ */}
      <Section tone="surface" labelledBy="faq-heading">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <h2 id="faq-heading" className="text-3xl font-semibold tracking-tight">
              Common questions
            </h2>
            <p className="mt-3 text-muted-foreground">
              More answers on the{" "}
              <Link href="/faq" className="font-medium text-primary hover:underline">
                FAQ page
              </Link>
              .
            </p>
          </div>
          <FaqList items={[faqs.general[0], faqs.general[1], faqs.delivery[0], faqs.compliance[0], faqs.general[3]]} />
        </div>
      </Section>

      <CtaBand
        title="Send your first message today"
        description="Create an account, add balance, and send from the dashboard or the API."
        primary={{ label: "Start Sending SMS", href: "/register" }}
        secondary={{ label: "Talk to sales", href: "/contact" }}
      />
    </>
  );
}
