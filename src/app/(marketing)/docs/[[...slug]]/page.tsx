import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { JsonLd } from "@/components/marketing/blocks";
import { docPages, findDoc } from "@/content/docs";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return docPages.map((d) => ({ slug: d.slug ? [d.slug] : [] }));
}

function slugOf(parts?: string[]) {
  return parts?.join("/") ?? "";
}

export async function generateMetadata({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;
  const doc = findDoc(slugOf(slug));
  if (!doc) return {};
  return pageMetadata({ title: `${doc.title}: API docs`, description: doc.description, path: doc.slug ? `/docs/${doc.slug}` : "/docs" });
}

export default async function DocPage({ params }: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await params;
  const doc = findDoc(slugOf(slug));
  if (!doc) notFound();
  const idx = docPages.indexOf(doc);
  const prev = docPages[idx - 1];
  const next = docPages[idx + 1];
  const href = (d: typeof doc) => (d.slug ? `/docs/${d.slug}` : "/docs");
  const Content = doc.Content;

  return (
    <div className="grid gap-10 xl:grid-cols-[1fr_13rem]">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Documentation", path: "/docs" },
          ...(doc.slug ? [{ name: doc.title, path: `/docs/${doc.slug}` }] : []),
        ])}
      />
      <article className="prose-doc min-w-0 max-w-[72ch]">
        <p className="!mb-2 text-sm font-medium text-accent">{doc.group}</p>
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{doc.title}</h1>
        <p className="!mt-3 text-lg !text-muted-foreground">{doc.description}</p>
        <Content />
        <nav aria-label="Pagination" className="not-prose mt-14 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
          {prev ? (
            <Link href={href(prev)} className="group rounded-lg border border-border p-4 hover:border-primary/40">
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowLeft className="size-3" aria-hidden /> Previous
              </span>
              <span className="mt-1 block text-sm font-medium group-hover:text-primary">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={href(next)} className="group rounded-lg border border-border p-4 text-right hover:border-primary/40">
              <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                Next <ArrowRight className="size-3" aria-hidden />
              </span>
              <span className="mt-1 block text-sm font-medium group-hover:text-primary">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      <aside className="hidden xl:block">
        <nav aria-label="On this page" className="sticky top-24">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">On this page</p>
          <ul className="space-y-2 text-sm">
            {doc.toc.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="text-muted-foreground hover:text-foreground">
                  {t.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
    </div>
  );
}
