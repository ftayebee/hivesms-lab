import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  const base = siteConfig.url.replace(/\/$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/dashboard", "/admin", "/api/", "/verify-email", "/reset-password", "/invite", "/onboarding"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
