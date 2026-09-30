import { Suspense } from "react";
import { Clock, Mail, MapPin, Phone, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Container, JsonLd } from "@/components/marketing/blocks";
import { ContactForm } from "@/components/marketing/contact-form";
import { getSiteContent } from "@/services/settings";
import { siteConfig } from "@/config/site";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Contact sales and support",
  description: "Contact the SMSFlow BD team about pricing, sender IDs, API integration or support.",
  path: "/contact",
});

export const revalidate = 300;

export default async function ContactPage() {
  const { contactResolved: c } = await getSiteContent();
  const items = [
    { icon: Mail, label: "Sales", value: c.salesEmail, href: `mailto:${c.salesEmail}` },
    { icon: Mail, label: "Support", value: c.supportEmail, href: `mailto:${c.supportEmail}` },
    { icon: Phone, label: "Phone", value: c.phone },
    { icon: MapPin, label: "Office", value: c.address },
    { icon: Clock, label: "Hours", value: c.hours },
  ];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }])} />
      <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: siteConfig.name, url: siteConfig.url, email: c.email, contactPoint: [{ "@type": "ContactPoint", contactType: "sales", email: c.salesEmail, areaServed: "BD", availableLanguage: ["en", "bn"] }] }} />
      <Container className="grid gap-12 py-16 md:py-20 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Talk to us</h1>
          <p className="mt-4 text-lg text-muted-foreground">Questions about pricing, sender IDs or integrating the API? Send a message and the right person will reply.</p>
          <ul className="mt-10 space-y-5">
            {items.map((i) => (
              <li key={i.label} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
                  <i.icon className="size-4" aria-hidden />
                </span>
                <div className="text-sm">
                  <p className="font-medium">{i.label}</p>
                  {i.href ? (
                    <a href={i.href} className="text-muted-foreground hover:text-primary">
                      {i.value}
                    </a>
                  ) : (
                    <p className="text-muted-foreground">{i.value}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex gap-3 rounded-lg border border-border bg-surface p-4 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-muted-foreground">
              Received a suspicious or unwanted SMS from a sender on this platform?{" "}
              <Link href="/report-abuse" className="font-medium text-primary hover:underline">
                Report abuse
              </Link>
              .
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm md:p-8">
          <h2 className="mb-6 text-lg font-semibold">Send us a message</h2>
          <Suspense>
            <ContactForm />
          </Suspense>
        </div>
      </Container>
    </>
  );
}
