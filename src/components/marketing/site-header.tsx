"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavigationMenu as NM, Dialog as D } from "radix-ui";
import { ChevronDown, Menu } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Button } from "@/components/ui/button";
import { SheetContent } from "@/components/ui/dialog";
import { mainNav, type NavLink } from "@/config/navigation";
import { getMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCloseOnNavigate } from "@/hooks/use-close-on-navigate";

const t = getMessages("en");
const labelOf = (l: { labelKey?: keyof typeof t.nav; label?: string }) => (l.labelKey ? t.nav[l.labelKey] : l.label ?? "");

export function SiteHeader() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useCloseOnNavigate();
  const pathname = usePathname();

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} className="absolute left-0 top-0 h-2 w-px" aria-hidden />
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t.nav.skipToContent}
      </a>
      <header
        className={cn(
          "sticky top-0 z-40 w-full border-b transition-[background-color,border-color,box-shadow] duration-200",
          scrolled ? "border-border bg-background/90 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80" : "border-transparent bg-background",
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="shrink-0 rounded-md" aria-label="SMSFlow BD home">
            <Logo />
          </Link>

          <NM.Root className="relative hidden flex-1 lg:block" aria-label="Main">
            <NM.List className="flex items-center gap-0.5">
              {mainNav.map((group) =>
                group.items ? (
                  <NM.Item key={group.labelKey}>
                    <NM.Trigger className="group inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:text-foreground">
                      {t.nav[group.labelKey]}
                      <ChevronDown className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180" aria-hidden />
                    </NM.Trigger>
                    <NM.Content className="absolute left-0 top-full pt-2 data-[motion]:animate-fade-in">
                      <NavPanel items={group.items} wide={group.items.length > 4} viewAllHref={group.href} />
                    </NM.Content>
                  </NM.Item>
                ) : (
                  <NM.Item key={group.labelKey}>
                    <NM.Link asChild active={pathname === group.href}>
                      <Link
                        href={group.href!}
                        className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground data-[active]:text-foreground"
                      >
                        {t.nav[group.labelKey]}
                      </Link>
                    </NM.Link>
                  </NM.Item>
                ),
              )}
            </NM.List>
          </NM.Root>

          <div className="ml-auto hidden items-center gap-2 lg:flex">
            <Button asChild variant="ghost">
              <Link href="/login">{t.nav.login}</Link>
            </Button>
            <Button asChild>
              <Link href="/register">{t.nav.getStarted}</Link>
            </Button>
          </div>

          <D.Root open={open} onOpenChange={setOpen}>
            <D.Trigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto lg:hidden" aria-label={t.nav.openMenu}>
                <Menu className="size-5" />
              </Button>
            </D.Trigger>
            <SheetContent side="right" title="Menu" className="w-[min(22rem,calc(100vw-2rem))]">
              <div className="flex h-16 items-center border-b border-border px-5">
                <Logo />
              </div>
              <nav aria-label="Mobile" className="flex-1 overflow-y-auto px-3 py-3">
                {mainNav.map((group) =>
                  group.items ? (
                    <details key={group.labelKey} className="group rounded-md">
                      <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-md px-3 text-[15px] font-medium hover:bg-muted [&::-webkit-details-marker]:hidden">
                        {t.nav[group.labelKey]}
                        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                      </summary>
                      <ul className="mb-2 ml-3 border-l border-border pl-2">
                        {group.items.map((item) => (
                          <li key={item.href}>
                            <Link href={item.href} className="flex h-10 items-center rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                              {labelOf(item)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : (
                    <Link key={group.labelKey} href={group.href!} className="flex h-11 items-center rounded-md px-3 text-[15px] font-medium hover:bg-muted">
                      {t.nav[group.labelKey]}
                    </Link>
                  ),
                )}
              </nav>
              <div className="grid gap-2 border-t border-border p-4">
                <Button asChild size="lg">
                  <Link href="/register">{t.nav.getStarted}</Link>
                </Button>
                <Button asChild size="lg" variant="secondary">
                  <Link href="/login">{t.nav.login}</Link>
                </Button>
              </div>
            </SheetContent>
          </D.Root>
        </div>
      </header>
    </>
  );
}

function NavPanel({ items, wide, viewAllHref }: { items: NavLink[]; wide?: boolean; viewAllHref?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-2 shadow-md", wide ? "w-[30rem]" : "w-80")}>
      <ul className={cn("grid gap-0.5", wide && "grid-cols-2")}>
        {items.map((item) => (
          <li key={item.href}>
            <NM.Link asChild>
              <Link href={item.href} className="block rounded-md px-3 py-2.5 hover:bg-muted focus-visible:bg-muted">
                <span className="block text-sm font-medium">{labelOf(item)}</span>
                {item.description && <span className="mt-0.5 block text-[13px] text-muted-foreground">{item.description}</span>}
              </Link>
            </NM.Link>
          </li>
        ))}
      </ul>
      {viewAllHref && (
        <NM.Link asChild>
          <Link href={viewAllHref} className="mt-1 block rounded-md border-t border-border px-3 pb-1 pt-2.5 text-[13px] font-medium text-primary hover:underline">
            View all solutions
          </Link>
        </NM.Link>
      )}
    </div>
  );
}
