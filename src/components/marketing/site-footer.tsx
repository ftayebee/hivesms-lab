import Link from "next/link";
import { Logo } from "@/components/shared/logo";
import { footerNav } from "@/config/navigation";
import { siteConfig } from "@/config/site";

export function SiteFooter({ contact = siteConfig.contact }: { contact?: typeof siteConfig.contact }) {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_2fr]">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{siteConfig.description}</p>
            <address className="mt-5 space-y-1 text-sm not-italic text-muted-foreground">
              <p>{contact.address}</p>
              <p>
                <a className="hover:text-foreground" href={`mailto:${contact.email}`}>
                  {contact.email}
                </a>
              </p>
              <p>{contact.phone}</p>
            </address>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {footerNav.map((col) => (
              <div key={col.title}>
                <h2 className="text-sm font-semibold">{col.title}</h2>
                <ul className="mt-3 space-y-2">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="text-sm text-muted-foreground hover:text-foreground">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {siteConfig.legalName}. All prices in BDT. VAT shown separately.
          </p>
          <p>Message delivery depends on the connected SMS provider and mobile operators.</p>
        </div>
      </div>
    </footer>
  );
}
