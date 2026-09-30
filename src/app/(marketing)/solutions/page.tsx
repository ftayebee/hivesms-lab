import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CtaBand, JsonLd, PageHero, Section } from "@/components/marketing/blocks";
import { solutions } from "@/content/marketing";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "SMS solutions by industry",
  description: "How e-commerce, education, healthcare, banking, retail, logistics, NGOs and software companies in Bangladesh use SMS for notifications, OTPs and campaigns.",
  path: "/solutions",
});

export default function SolutionsPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Solutions", path: "/solutions" }])} />
      <PageHero eyebrow="Solutions" title="SMS for the way your industry works" description="Practical use cases, example messages and the features that matter most in each sector." />
      <Section labelledBy="sol-h">
        <h2 id="sol-h" className="sr-only">
          Industries
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {solutions.map((s) => (
            <li key={s.slug}>
              <Link href={`/solutions/${s.slug}`} className="group flex h-full flex-col rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40">
                <h3 className="text-[15px] font-semibold group-hover:text-primary">{s.name}</h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">{s.summary}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                  View use cases <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title="Don't see your industry?" description="Tell us what you need to send and we'll help you set it up." primary={{ label: "Contact us", href: "/contact" }} />
    </>
  );
}
