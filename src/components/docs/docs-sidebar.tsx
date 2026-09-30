"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { BookOpen, ChevronDown } from "lucide-react";
import { SheetContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface SidebarItem {
  href: string;
  title: string;
}

function NavList({ items, onNavigate }: { items: SidebarItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((i) => {
        const active = pathname === i.href;
        return (
          <li key={i.href}>
            <Link
              href={i.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "block rounded-md px-3 py-1.5 text-sm transition-colors",
                active ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {i.title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Documentation navigation: fixed column on desktop, sheet on mobile. */
export function DocumentationSidebar({ items }: { items: SidebarItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const current = items.find((i) => i.href === pathname)?.title ?? "Documentation";
  return (
    <>
      <div className="sticky top-16 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur lg:hidden">
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm font-medium">
            <span className="flex items-center gap-2">
              <BookOpen className="size-4 text-muted-foreground" aria-hidden />
              {current}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
          </D.Trigger>
          <SheetContent title="Documentation navigation" side="left">
            <div className="flex h-14 items-center border-b border-border px-5 text-sm font-semibold">Documentation</div>
            <nav aria-label="Documentation" className="overflow-y-auto p-3">
              <NavList items={items} onNavigate={() => setOpen(false)} />
            </nav>
          </SheetContent>
        </D.Root>
      </div>
      <nav aria-label="Documentation" className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto pb-8 lg:block">
        <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Documentation</p>
        <NavList items={items} />
      </nav>
    </>
  );
}
