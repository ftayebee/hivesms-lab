import { DocumentationSidebar } from "@/components/docs/docs-sidebar";
import { docPages } from "@/content/docs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const items = docPages.map((d) => ({ href: d.slug ? `/docs/${d.slug}` : "/docs", title: d.title }));
  return (
    <div className="mx-auto grid max-w-7xl gap-8 px-4 sm:px-6 lg:grid-cols-[15rem_1fr] lg:px-8">
      <aside className="lg:pt-10">
        <DocumentationSidebar items={items} />
      </aside>
      <div className="min-w-0 pb-20 pt-8 lg:pt-10">{children}</div>
    </div>
  );
}
