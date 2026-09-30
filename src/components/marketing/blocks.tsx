import Link from "next/link";
import { ArrowRight, Check, ChevronDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Container({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

export function Section({ id, className, children, tone = "default", labelledBy }: { id?: string; className?: string; children: React.ReactNode; tone?: "default" | "surface"; labelledBy?: string }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("py-20 md:py-24", tone === "surface" && "border-y border-border bg-surface", className)}>
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({ id, title, description, eyebrow, align = "left", className }: { id?: string; title: string; description?: string; eyebrow?: string; align?: "left" | "center"; className?: string }) {
  return (
    <div className={cn("max-w-2xl", align === "center" && "mx-auto text-center", className)}>
      {eyebrow && <p className="mb-3 text-sm font-semibold text-accent">{eyebrow}</p>}
      <h2 id={id} className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
        {title}
      </h2>
      {description && <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">{description}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, description, primary, secondary, children }: { eyebrow?: string; title: string; description: string; primary?: { label: string; href: string }; secondary?: { label: string; href: string }; children?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(60%_60%_at_20%_0%,var(--primary-soft),transparent_70%)]" />
      <Container className={cn("relative grid gap-12 py-16 md:py-20 [&>*]:min-w-0", children && "lg:grid-cols-[1.05fr_1fr] lg:items-center")}>
        <div className="max-w-2xl">
          {eyebrow && <p className="mb-4 text-sm font-semibold text-accent">{eyebrow}</p>}
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">{title}</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">{description}</p>
          {(primary || secondary) && (
            <div className="mt-8 flex flex-wrap gap-3">
              {primary && (
                <Button asChild size="lg">
                  <Link href={primary.href}>
                    {primary.label} <ArrowRight />
                  </Link>
                </Button>
              )}
              {secondary && (
                <Button asChild size="lg" variant="secondary">
                  <Link href={secondary.href}>{secondary.label}</Link>
                </Button>
              )}
            </div>
          )}
        </div>
        {children}
      </Container>
    </section>
  );
}

export interface FeatureItem {
  icon: LucideIcon;
  title: string;
  body: string;
  href?: string;
}

/** Feature grid with icon tiles. `feature` renders the first item as a wide tile. */
export function FeatureGrid({ items, columns = 3 }: { items: FeatureItem[]; columns?: 2 | 3 | 4 }) {
  const cols = { 2: "md:grid-cols-2", 3: "md:grid-cols-2 lg:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" };
  return (
    <ul className={cn("grid gap-px overflow-hidden rounded-lg border border-border bg-border", cols[columns])}>
      {items.map((f) => (
        <li key={f.title} className="bg-card p-6">
          <span className="grid size-9 place-items-center rounded-md bg-primary-soft text-primary">
            <f.icon className="size-[18px]" aria-hidden />
          </span>
          <h3 className="mt-4 text-[15px] font-semibold">{f.title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          {f.href && (
            <Link href={f.href} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Learn more <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CheckList({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((i) => (
        <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
          <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span>{i}</span>
        </li>
      ))}
    </ul>
  );
}

/** Horizontal (desktop) / vertical (mobile) process flow. */
export function FlowSteps({ steps, note }: { steps: { title: string; body?: string; icon?: LucideIcon }[]; note?: string }) {
  return (
    <div>
      <ol className="grid gap-3 md:grid-flow-col md:auto-cols-fr">
        {steps.map((s, i) => (
          <li key={s.title} className="relative rounded-lg border border-border bg-card p-4 shadow-xs">
            <div className="flex items-center gap-2.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground tabular">{i + 1}</span>
              <span className="text-sm font-semibold">{s.title}</span>
            </div>
            {s.body && <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>}
            {i < steps.length - 1 && (
              <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-background text-muted-foreground md:block" aria-hidden />
            )}
          </li>
        ))}
      </ol>
      {note && <p className="mt-4 text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Accessible FAQ list (native details/summary) plus FAQPage structured data. */
export function FaqList({ items, withSchema = true }: { items: { q: string; a: string }[]; withSchema?: boolean }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
  };
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((item) => (
        <details key={item.q} className="group px-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="pb-5 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
        </details>
      ))}
      {withSchema && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />}
    </div>
  );
}

export function CtaBand({ title, description, primary, secondary }: { title: string; description: string; primary: { label: string; href: string }; secondary?: { label: string; href: string } }) {
  return (
    <section className="py-20">
      <Container>
        <div className="relative overflow-hidden rounded-xl bg-primary px-6 py-12 text-primary-foreground md:px-12">
          <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/30 blur-3xl" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h2>
              <p className="mt-2 text-primary-foreground/80">{description}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-primary-foreground text-primary hover:bg-primary-foreground/90">
                <Link href={primary.href}>{primary.label}</Link>
              </Button>
              {secondary && (
                <Button asChild size="lg" variant="outline" className="border-primary-foreground/40 text-primary-foreground hover:bg-primary-foreground/10">
                  <Link href={secondary.href}>{secondary.label}</Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
