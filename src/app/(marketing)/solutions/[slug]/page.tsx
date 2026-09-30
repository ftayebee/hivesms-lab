import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand, JsonLd, PageHero, Section, SectionHeading } from "@/components/marketing/blocks";
import { Badge } from "@/components/ui/badge";
import { solutions } from "@/content/marketing";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export function generateStaticParams() {
  return solutions.map((s) => ({ slug: s.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: PageProps<"/solutions/[slug]">) {
  const { slug } = await params;
  const s = solutions.find((x) => x.slug === slug);
  if (!s) return {};
  return pageMetadata({ title: s.title, description: s.summary, path: `/solutions/${s.slug}` });
}

export default async function SolutionPage({ params }: PageProps<"/solutions/[slug]">) {
  const { slug } = await params;
  const s = solutions.find((x) => x.slug === slug);
  if (!s) notFound();
  const others = solutions.filter((x) => x.slug !== s.slug).slice(0, 4);

  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Solutions", path: "/solutions" }, { name: s.name, path: `/solutions/${s.slug}` }])} />
      <PageHero eyebrow={s.name} title={s.title} description={s.summary} primary={{ label: "Get started", href: "/register" }} secondary={{ label: "Talk to sales", href: "/contact" }} />
      <Section labelledBy="uc-h">
        <SectionHeading id="uc-h" title="Common use cases" description="Example messages are illustrative. Adapt them to your brand and keep promotional messages to opted-in contacts." />
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {s.useCases.map((u) => (
            <li key={u.title} className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-[15px] font-semibold">{u.title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{u.body}</p>
              <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2.5 font-bangla text-sm">{u.example}</p>
            </li>
          ))}
        </ul>
      </Section>
      <Section tone="surface" labelledBy="rec-h">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 id="rec-h" className="text-2xl font-semibold tracking-tight">
              Features {s.name.toLowerCase()} teams use most
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {s.recommended.map((r) => (
                <li key={r}>
                  <Badge tone="outline" className="bg-card px-3 py-1 text-sm">
                    {r}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
          <Link href="/features" className="text-sm font-medium text-primary hover:underline">
            All features →
          </Link>
        </div>
      </Section>
      <Section labelledBy="other-h">
        <h2 id="other-h" className="text-lg font-semibold">
          Other industries
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {others.map((o) => (
            <li key={o.slug}>
              <Link href={`/solutions/${o.slug}`} className="block rounded-lg border border-border bg-card p-4 text-sm font-medium hover:border-primary/40 hover:text-primary">
                {o.name}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={`Start messaging your ${s.name.toLowerCase()} customers`} description="Create an account and send a test message today." primary={{ label: "Create account", href: "/register" }} />
    </>
  );
}
