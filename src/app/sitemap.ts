import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";
import { solutions } from "@/content/marketing";
import { docPages } from "@/content/docs";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteConfig.url.replace(/\/$/, "");
  const now = new Date();
  const pages: [string, number, MetadataRoute.Sitemap[number]["changeFrequency"]][] = [
    ["/", 1, "weekly"],
    ["/features", 0.8, "monthly"],
    ["/bulk-sms", 0.9, "monthly"],
    ["/transactional-sms", 0.9, "monthly"],
    ["/promotional-sms", 0.8, "monthly"],
    ["/sms-api", 0.9, "monthly"],
    ["/pricing", 0.9, "weekly"],
    ["/solutions", 0.7, "monthly"],
    ["/about", 0.5, "yearly"],
    ["/contact", 0.6, "yearly"],
    ["/faq", 0.6, "monthly"],
    ["/docs", 0.8, "weekly"],
    ["/terms", 0.2, "yearly"],
    ["/privacy", 0.2, "yearly"],
    ["/refund-policy", 0.2, "yearly"],
    ["/report-abuse", 0.3, "yearly"],
    ["/register", 0.5, "yearly"],
    ["/login", 0.3, "yearly"],
  ];
  return [
    ...pages.map(([p, priority, changeFrequency]) => ({ url: `${base}${p}`, lastModified: now, changeFrequency, priority })),
    ...solutions.map((s) => ({ url: `${base}/solutions/${s.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...docPages.filter((d) => d.slug).map((d) => ({ url: `${base}/docs/${d.slug}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}
