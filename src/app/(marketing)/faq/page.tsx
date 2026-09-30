import Link from "next/link";
import { Container, FaqList, JsonLd } from "@/components/marketing/blocks";
import { allFaqs, faqs } from "@/content/marketing";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Frequently asked questions",
  description: "Answers about SMS pricing, segments, Bangla messages, masking and non-masking sender IDs, delivery reports, opt-outs and the SMS API.",
  path: "/faq",
});

const sections = [
  { id: "general", title: "General and pricing", items: faqs.general },
  { id: "delivery", title: "Delivery", items: faqs.delivery },
  { id: "compliance", title: "Compliance and opt-outs", items: faqs.compliance },
  { id: "developers", title: "Developers", items: faqs.developers },
];

export default function FaqPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "FAQ", path: "/faq" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: allFaqs.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.a } })),
        }}
      />
      <Container className="grid gap-12 py-16 md:py-20 lg:grid-cols-[14rem_1fr]">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight lg:text-3xl">FAQ</h1>
          <nav aria-label="FAQ sections" className="mt-6 lg:sticky lg:top-24">
            <ul className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <div className="space-y-12">
          {sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24">
              <h2 id={`${s.id}-h`} className="mb-4 text-xl font-semibold">
                {s.title}
              </h2>
              <FaqList items={s.items} withSchema={false} />
            </section>
          ))}
          <p className="text-sm text-muted-foreground">
            Still have a question?{" "}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              Contact us
            </Link>
            .
          </p>
        </div>
      </Container>
    </>
  );
}
