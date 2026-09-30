import { AppWindow, Cloud, KeyRound, Radio, Smartphone, RotateCcw, Webhook, Gauge } from "lucide-react";
import { CtaBand, FaqList, FeatureGrid, JsonLd, PageHero, Section, SectionHeading } from "@/components/marketing/blocks";
import { ApiCodeBlock } from "@/components/docs/code-block";
import { sendSmsSamples } from "@/content/api-samples";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Transactional SMS and OTP API",
  description: "Send OTPs, order confirmations, payment alerts and account notifications in Bangladesh through a REST API with idempotency, webhooks and delivery tracking.",
  path: "/transactional-sms",
});

const useCases = [
  { t: "OTP", e: "Your verification code is 482913. It expires in 5 minutes." },
  { t: "Login verification", e: "A sign-in was requested from a new device. Code: 118204." },
  { t: "Order confirmation", e: "Order #10234 confirmed. Total BDT 2,450." },
  { t: "Payment notification", e: "Payment of BDT 1,200 received. Thank you." },
  { t: "Delivery update", e: "Your parcel is out for delivery today." },
  { t: "Account alert", e: "Your password was changed. If this wasn't you, contact us." },
  { t: "Password reset", e: "Use code 773019 to reset your password." },
  { t: "Appointment reminder", e: "Reminder: appointment tomorrow at 11:00." },
];

const flow = [
  { icon: AppWindow, title: "Your application", body: "Your backend decides a message is needed." },
  { icon: KeyRound, title: "SMSFlow API", body: "Authenticated request, validated and priced." },
  { icon: Cloud, title: "SMS platform", body: "Queued, charged, dispatched with retries." },
  { icon: Radio, title: "Carrier / provider", body: "Upstream provider routes to the operator." },
  { icon: Smartphone, title: "Customer", body: "Delivered to the handset; report flows back." },
];

export default function TransactionalPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Transactional SMS", path: "/transactional-sms" }])} />
      <PageHero
        eyebrow="Transactional SMS"
        title="OTPs and alerts, sent the moment your app needs them"
        description="A single authenticated API call sends a message. Retries are safe, every status is reported, and failed messages are refunded per policy."
        primary={{ label: "Get an API key", href: "/register" }}
        secondary={{ label: "Read the docs", href: "/docs/send-sms" }}
      >
        <ApiCodeBlock samples={sendSmsSamples} title="Send an OTP" />
      </PageHero>

      <Section labelledBy="what-h">
        <SectionHeading id="what-h" title="What counts as transactional" description="Transactional messages are triggered by something the recipient did or needs to know about their account. They are not advertising. Keep them that way: mixing offers into transactional traffic can get it filtered." />
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {useCases.map((u) => (
            <li key={u.t} className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-semibold">{u.t}</h3>
              <p className="mt-2 rounded-md bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">{u.e}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="surface" labelledBy="flow-h">
        <SectionHeading id="flow-h" title="How a message travels" />
        <ol className="mt-10 grid gap-3 md:grid-cols-5">
          {flow.map((s, i) => (
            <li key={s.title} className="relative rounded-lg border border-border bg-card p-4">
              <s.icon className="size-5 text-primary" aria-hidden />
              <h3 className="mt-3 text-sm font-semibold">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
              <p className="mt-1 text-[13px] text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-5 max-w-3xl text-sm text-muted-foreground">
          The route from the platform to the mobile operator depends on the upstream SMS provider this platform is connected to. Delivery speed and delivery reports depend on that provider and on the operators; we report what they report, as it arrives.
        </p>
      </Section>

      <Section labelledBy="rel-h">
        <SectionHeading id="rel-h" title="Designed for reliability under real conditions" />
        <div className="mt-10">
          <FeatureGrid
            columns={4}
            items={[
              { icon: RotateCcw, title: "Idempotent requests", body: "Send an Idempotency-Key; a network retry returns the first response instead of sending again." },
              { icon: Webhook, title: "Delivery webhooks", body: "Get delivered and failed events pushed to your endpoint, signed and retried." },
              { icon: Gauge, title: "Clear rate limits", body: "Limits are returned in response headers so your client can back off gracefully." },
              { icon: KeyRound, title: "Least-privilege keys", body: "Give each service its own key with only the scopes it needs." },
            ]}
          />
        </div>
      </Section>

      <Section tone="surface" labelledBy="faq-h">
        <SectionHeading id="faq-h" title="Questions about transactional SMS" />
        <div className="mt-8 max-w-3xl">
          <FaqList
            items={[
              { q: "How fast are OTPs delivered?", a: "The platform queues and dispatches API messages immediately. End-to-end speed depends on the upstream provider and the recipient's operator, so we do not publish a guaranteed delivery time. Delivery timestamps are visible per message." },
              { q: "Do opt-outs apply to transactional messages?", a: "Opt-out filtering applies to promotional messages. Transactional messages such as OTPs are sent because the recipient requested or needs them. Do not use transactional traffic for marketing." },
              { q: "Can I use a branded sender ID for OTPs?", a: "Yes, once the sender ID is approved. Until then you can send from the shared non-masking number." },
            ]}
          />
        </div>
      </Section>

      <CtaBand title="Integrate in an afternoon" description="Create an account, generate a scoped key and send your first test message." primary={{ label: "Create account", href: "/register" }} secondary={{ label: "Quick start", href: "/docs/quick-start" }} />
    </>
  );
}
