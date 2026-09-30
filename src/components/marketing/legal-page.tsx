import { Container } from "@/components/marketing/blocks";
import { Alert } from "@/components/ui/misc";

/** Layout for legal documents: TOC + readable prose + template notice. */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { id: string; title: string; body: React.ReactNode }[] }) {
  return (
    <Container className="grid gap-12 py-16 md:py-20 lg:grid-cols-[15rem_1fr]">
      <aside>
        <nav aria-label="On this page" className="lg:sticky lg:top-24">
          <p className="mb-3 text-sm font-semibold">On this page</p>
          <ol className="space-y-1.5 text-sm">
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">
                  {i + 1}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <article className="prose-doc">
        <h1 className="text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="!mt-3 text-sm text-muted-foreground">Last updated: {updated}</p>
        <Alert tone="warning" className="not-prose my-6" title="Template document">
          This is a starting template written for this platform. The operator must complete the bracketed details and have it reviewed by a qualified lawyer in Bangladesh before publishing.
        </Alert>
        {sections.map((s, i) => (
          <section key={s.id} aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`}>
              <a id={s.id} className="!no-underline !text-foreground">
                {i + 1}. {s.title}
              </a>
            </h2>
            {s.body}
          </section>
        ))}
      </article>
    </Container>
  );
}
