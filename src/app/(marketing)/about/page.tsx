import { Eye, Scale, ShieldCheck, Wrench } from "lucide-react";
import { CtaBand, JsonLd, PageHero, Section, SectionHeading } from "@/components/marketing/blocks";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { siteConfig } from "@/config/site";

export const metadata = pageMetadata({
  title: "About us",
  description: "SMSFlow BD is an SMS communication platform for businesses and developers in Bangladesh, built around transparency, reliability and responsible messaging.",
  path: "/about",
});

const principles = [
  { icon: Eye, t: "Transparent", b: "Rates, segments, VAT and refunds are visible before you pay or send. No hidden fees and no inflated statistics." },
  { icon: Wrench, t: "Built for builders", b: "A clean, versioned API with the details developers expect: idempotency, webhooks, clear errors and rate-limit headers." },
  { icon: ShieldCheck, t: "Responsible", b: "Consent tracking, opt-outs and review workflows keep messaging wanted, which keeps it deliverable." },
  { icon: Scale, t: "Honest about limits", b: "Delivery depends on providers and operators. We show what happened to each message instead of promising what nobody can guarantee." },
];

export default function AboutPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "About", path: "/about" }])} />
      <PageHero eyebrow="About us" title="SMS infrastructure that businesses can understand and trust" description={`${siteConfig.name} helps organizations in Bangladesh send the messages their customers rely on: codes, confirmations, reminders and offers they asked for.`} />
      <Section labelledBy="why-h">
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeading id="why-h" title="Why we built it" />
          <div className="space-y-4 text-base leading-relaxed text-muted-foreground">
            <p>SMS is still the channel that reaches almost everyone in Bangladesh, whatever their phone or data plan. Yet many business SMS services are hard to evaluate: prices hide segment rules, delivery claims can&apos;t be checked, and developer tooling stops at a single URL with an API key in the query string.</p>
            <p>We set out to build a platform where a shop owner can run a campaign without training, a developer can integrate OTPs in an afternoon, and a finance team can reconcile every taka on an invoice.</p>
            <p>The platform is provider-agnostic: messages are routed through licensed upstream providers configured by the operator, and every result they report is passed on to you.</p>
          </div>
        </div>
      </Section>
      <Section tone="surface" labelledBy="principles-h">
        <SectionHeading id="principles-h" title="What we care about" />
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {principles.map((p) => (
            <li key={p.t} className="flex gap-4 rounded-lg border border-border bg-card p-6">
              <p.icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <div>
                <h3 className="text-[15px] font-semibold">{p.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{p.b}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title="Work with us" description="Tell us about your messaging needs, or create an account and try the platform." primary={{ label: "Get started", href: "/register" }} secondary={{ label: "Contact us", href: "/contact" }} />
    </>
  );
}
