import Link from "next/link";
import { Check } from "lucide-react";
import { Container, CtaBand, FaqList, JsonLd, Section, SectionHeading } from "@/components/marketing/blocks";
import { PricingCalculator } from "@/components/marketing/pricing-calculator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { loadPublicPricing, type PublicPlan } from "@/services/billing/pricing";
import { formatBDT } from "@/lib/format";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { cn } from "@/lib/utils";

export const metadata = pageMetadata({
  title: "Pricing",
  description: "Transparent BDT pricing per SMS segment for transactional and promotional messages, masking and non-masking sender IDs. VAT shown separately. Pricing calculator included.",
  path: "/pricing",
});

// Plans come from the database (Admin → Pricing). Re-generated at most every 5 minutes.
export const revalidate = 300;

function PricingCard({ plan }: { plan: PublicPlan }) {
  const rows: [string, number][] = [
    ["Transactional, non-masking", plan.transactionalNonMasking],
    ["Transactional, masking", plan.transactionalMasking],
    ["Promotional, non-masking", plan.promotionalNonMasking],
    ["Promotional, masking", plan.promotionalMasking],
  ];
  return (
    <article className={cn("flex flex-col rounded-xl border bg-card p-6 shadow-xs", plan.highlighted ? "border-primary ring-1 ring-primary" : "border-border")}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        {plan.highlighted && <Badge tone="primary">Most chosen</Badge>}
      </div>
      <p className="mt-2 min-h-10 text-sm text-muted-foreground">{plan.description}</p>
      <div className="mt-6">
        {plan.isCustom ? (
          <p className="text-3xl font-semibold tracking-tight">Custom pricing</p>
        ) : (
          <p className="text-3xl font-semibold tracking-tight tabular">
            {formatBDT(Math.min(plan.transactionalNonMasking, plan.promotionalNonMasking))}
            <span className="ml-1 text-base font-normal text-muted-foreground">/ SMS from</span>
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.isCustom ? `Typically from ${formatBDT(plan.minRechargeAmount, "en", { decimals: 0 })} per recharge` : `Minimum recharge ${formatBDT(plan.minRechargeAmount, "en", { decimals: 0 })}`}
        </p>
      </div>
      {!plan.isCustom && (
        <dl className="mt-6 space-y-2 rounded-lg bg-surface p-4 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium tabular">{formatBDT(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="mt-6 flex-1 space-y-2.5">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2 text-sm">
            <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
            {f}
          </li>
        ))}
      </ul>
      <Button asChild className="mt-8" variant={plan.highlighted ? "primary" : "secondary"} size="lg">
        <Link href={plan.isCustom ? "/contact?subject=Enterprise%20pricing" : "/register"}>{plan.isCustom ? "Contact sales" : "Get started"}</Link>
      </Button>
    </article>
  );
}

export default async function PricingPage() {
  const { plans, source, packages, policy } = await loadPublicPricing();

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }])} />
      <section className="border-b border-border bg-[radial-gradient(60%_80%_at_50%_0%,var(--primary-soft),transparent_70%)]">
        <Container className="py-16 text-center md:py-20">
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance md:text-5xl">Simple, transparent pricing in BDT</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Top up your wallet and pay per SMS segment. No monthly fee. Rates exclude VAT, which is added at top-up and shown on your invoice.
          </p>
        </Container>
      </section>

      <Section labelledBy="plans-h" className="pt-12">
        <h2 id="plans-h" className="sr-only">
          Plans
        </h2>
        {source === "defaults" && (
          <Alert tone="warning" className="mb-8" title="Example pricing">
            These rates are example values from configuration. The live rates are managed by the platform operator in Admin → Pricing.
          </Alert>
        )}
        <div className="grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <PricingCard key={p.key} plan={p} />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted-foreground">Rates are per SMS segment and exclude {policy.vatRatePercent}% VAT. Your plan is set from your recharge level or by agreement.</p>
      </Section>

      <Section id="calculator" tone="surface" labelledBy="calc-h" className="scroll-mt-20">
        <SectionHeading id="calc-h" title="Estimate your monthly cost" description="Enter your expected volume. We suggest the plan whose minimum recharge your spend would reach." />
        <div className="mt-10">
          <PricingCalculator plans={plans} vatRatePercent={policy.vatRatePercent} />
        </div>
      </Section>

      <Section labelledBy="how-h">
        <SectionHeading id="how-h" title="How billing works" />
        <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {[
            { t: "Wallet and credits", b: "You top up a BDT wallet. Each message deducts segments × your rate. The dashboard shows your balance and approximately how many SMS it covers." },
            { t: "Minimum purchase", b: `The smallest top-up is ${formatBDT(policy.minimumTopUp, "en", { decimals: 0 })}. Packages: ${packages.map((p) => p.name + (p.bonusPercent ? ` (+${p.bonusPercent}% bonus)` : "")).join(", ")}.` },
            { t: "Message length", b: "Up to 160 plain-text characters per segment (153 when split). Bangla and other Unicode: 70 per segment (67 when split). Limits depend on the provider and are shown in the composer." },
            { t: "Sender ID costs", b: plans.some((p) => p.senderIdFee > 0) ? "A one-time sender ID fee applies on some plans; it is shown before you submit a request." : "There is currently no platform fee for sender ID requests. Operator or regulatory fees, if any apply, are communicated before approval." },
            { t: "VAT and invoices", b: `${policy.vatRatePercent}% VAT is added to top-ups and shown separately on each invoice. Add your BIN in organization settings to have it printed.` },
            { t: "Refunds and expiry", b: `Messages that fail are refunded to your wallet per the refund policy. ${policy.balanceValidityMonths ? `Balance is valid for ${policy.balanceValidityMonths} months from the last top-up.` : "Balance does not expire."}` },
          ].map((x) => (
            <div key={x.t}>
              <h3 className="text-[15px] font-semibold">{x.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{x.b}</p>
            </div>
          ))}
        </div>
        <p className="mt-10 text-sm text-muted-foreground">
          Read the full{" "}
          <Link className="font-medium text-primary hover:underline" href="/refund-policy">
            refund policy
          </Link>{" "}
          and{" "}
          <Link className="font-medium text-primary hover:underline" href="/terms">
            terms
          </Link>
          .
        </p>
      </Section>

      <Section tone="surface" labelledBy="pfaq-h">
        <SectionHeading id="pfaq-h" title="Pricing questions" />
        <div className="mt-8 max-w-3xl">
          <FaqList
            items={[
              { q: "Is there a free trial?", a: "You can create an account and explore the dashboard without paying. Sending messages requires balance, because every message has a real cost from the network." },
              { q: "Which payment methods can I use?", a: "The payment methods available at checkout are shown in your dashboard and depend on what the platform operator has enabled. Bank transfer with manual verification is always possible." },
              { q: "Can I get a custom rate?", a: "Yes, for sustained high volume. Contact sales with your expected monthly volume and message types." },
            ]}
          />
        </div>
      </Section>

      <CtaBand title="Start with any amount above the minimum" description="Create your account, add balance and send your first message." primary={{ label: "Get started", href: "/register" }} secondary={{ label: "Contact sales", href: "/contact" }} />
    </>
  );
}
