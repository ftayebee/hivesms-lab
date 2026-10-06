"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as D } from "radix-ui";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  Building2,
  CreditCard,
  Flag,
  Gauge,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  ScrollText,
  Settings,
  Shield,
  Tags,
  UserCog,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { SheetContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { platformCan, type PlatformPermission, type PlatformRoleKey } from "@/lib/auth/permissions";
import { logoutAction } from "@/features/auth/actions";
import { cn } from "@/lib/utils";
import { useCloseOnNavigate } from "@/hooks/use-close-on-navigate";

const NAV: { href: string; label: string; icon: LucideIcon; perm: PlatformPermission; badgeKey?: string }[] = [
  { href: "/admin", label: "Overview", icon: Gauge, perm: "admin:access" },
  { href: "/admin/customers", label: "Customers", icon: Building2, perm: "admin:customers:read" },
  { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone, perm: "admin:campaigns:review", badgeKey: "campaigns" },
  { href: "/admin/messages", label: "Messages", icon: MessageSquare, perm: "admin:messages:read" },
  { href: "/admin/sender-ids", label: "Sender IDs", icon: BadgeCheck, perm: "admin:sender_ids:review", badgeKey: "senders" },
  { href: "/admin/wallets", label: "Wallets", icon: Wallet, perm: "admin:billing:read" },
  { href: "/admin/payments", label: "Payments", icon: CreditCard, perm: "admin:billing:read", badgeKey: "payments" },
  { href: "/admin/pricing", label: "Pricing", icon: Tags, perm: "admin:pricing:manage" },
  { href: "/admin/api-logs", label: "API logs", icon: Activity, perm: "admin:messages:read" },
  { href: "/admin/support", label: "Support", icon: LifeBuoy, perm: "admin:support", badgeKey: "tickets" },
  { href: "/admin/abuse", label: "Abuse & leads", icon: Flag, perm: "admin:abuse:manage", badgeKey: "abuse" },
  { href: "/admin/users", label: "Users", icon: UserCog, perm: "admin:users:manage" },
  { href: "/admin/roles", label: "Roles", icon: Shield, perm: "admin:access" },
  { href: "/admin/settings", label: "Settings", icon: Settings, perm: "admin:settings:manage" },
  { href: "/admin/audit-logs", label: "Audit logs", icon: ScrollText, perm: "admin:audit:read" },
];

export function AdminShell({ user, role, badges, children }: { user: { name: string; email: string }; role: PlatformRoleKey; badges: Record<string, number>; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useCloseOnNavigate();
  const [, start] = useTransition();
  const nav = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2 px-5">
        <Logo />
        <Badge tone="warning">Admin</Badge>
      </div>
      <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="space-y-0.5">
          {NAV.filter((n) => platformCan(role, n.perm)).map((n) => {
            const active = n.href === "/admin" ? pathname === n.href : pathname.startsWith(n.href);
            const count = n.badgeKey ? badges[n.badgeKey] : 0;
            return (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium", active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                >
                  <n.icon className="size-4" aria-hidden />
                  <span className="flex-1">{n.label}</span>
                  {count > 0 && (
                    <span className="rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning tabular" aria-label={`${count} waiting`}>
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="border-t border-border p-3">
        <Link href="/dashboard" className="flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Customer dashboard
        </Link>
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh bg-surface">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-background lg:block">{nav}</aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur md:px-6">
          <D.Root open={open} onOpenChange={setOpen}>
            <D.Trigger className="grid size-9 place-items-center rounded-md hover:bg-muted lg:hidden" aria-label="Open menu">
              <Menu className="size-5" aria-hidden />
            </D.Trigger>
            <SheetContent title="Admin navigation" className="w-72">
              {nav}
            </SheetContent>
          </D.Root>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Signed in as <span className="font-medium text-foreground">{user.name}</span> · {role.replace("_", " ").toLowerCase()}
          </p>
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => start(() => logoutAction())} className="flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
