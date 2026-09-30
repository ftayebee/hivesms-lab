import type { Metadata } from "next";
import { siteConfig } from "@/config/site";

/** Unique, complete metadata for a public page (canonical URL, Open Graph, Twitter card). */
export function pageMetadata({ title, description, path, noindex }: { title: string; description: string; path: string; noindex?: boolean }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} | ${siteConfig.name}`, description, url: path, siteName: siteConfig.name, type: "website", locale: siteConfig.locale },
    twitter: { card: "summary_large_image", title: `${title} | ${siteConfig.name}`, description },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  };
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${siteConfig.url}${it.path}` })),
  };
}
