"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import {
  BadgeCheck,
  BarChart3,
  Bell,
  BookUser,
  Building2,
  Check,
  ChevronsUpDown,
  Code2,
  Languages,
  LayoutDashboard,
  LayoutTemplate,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  Receipt,
  Send,
  Settings,
  Shield,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { SheetContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { Avatar } from "@/components/ui/misc";
import { dashboardNav, type NavIconName } from "@/config/dashboard-nav";
import { useI18n } from "@/i18n/client";
import { LOCALE_LABELS, LOCALES } from "@/i18n";
import { cn } from "@/lib/utils";
import { useCloseOnNavigate } from "@/hooks/use-close-on-navigate";
import { logoutAction, setLocaleAction, switchOrganizationAction } from "@/features/auth/actions";

const ICONS: Record<NavIconName, LucideIcon> = {
  LayoutDashboard,
  Megaphone,
  Send,
  BookUser,
  LayoutTemplate,
  BadgeCheck,
  BarChart3,
  Code2,
  Wallet,
  Receipt,
  Users,
  LifeBuoy,
  Settings,
};

export interface ShellProps {
  user: { name: string; email: string; isStaff: boolean };
  organization: { id: string; name: string; roleName: string };
  organizations: { id: string; name: string }[];
  permissions: readonly string[];
  unreadNotifications: number;
  balanceLabel: string | null;
  children: React.ReactNode;
}

function SidebarNav({ permissions, onNavigate }: { permissions: readonly string[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();
  return (
    <nav aria-label="Dashboard" className="space-y-5">
      {dashboardNav.map((group, gi) => {
        const items = group.items.filter((i) => !i.permission || permissions.includes(i.permission));
        if (!items.length) return null;
        return (
          <div key={gi}>
            {group.section && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">{t.dashboardNav[group.section]}</p>}
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                        active ? "bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {t.dashboardNav[item.key]}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function OrgSwitcher({ organization, organizations }: Pick<ShellProps, "organization" | "organizations">) {
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-2.5 py-2 text-left shadow-xs hover:bg-muted disabled:opacity-60"
        disabled={pending}
        aria-label={`Organization: ${organization.name}. Switch organization`}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
          <Building2 className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{organization.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{organization.roleName}</span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => o.id !== organization.id && start(() => switchOrganizationAction(o.id))}>
            <Building2 />
            <span className="flex-1 truncate">{o.name}</span>
            {o.id === organization.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DashboardShell({ user, organization, organizations, permissions, unreadNotifications, balanceLabel, children }: ShellProps) {
  const [open, setOpen] = useCloseOnNavigate();
  const router = useRouter();
  const { locale, t } = useI18n();
  const [, start] = useTransition();

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href="/dashboard" aria-label="Dashboard home">
          <Logo />
        </Link>
      </div>
      <div className="px-3 pb-3">
        <OrgSwitcher organization={organization} organizations={organizations} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        <SidebarNav permissions={permissions} onNavigate={onNavigate} />
      </div>
      {user.isStaff && (
        <div className="border-t border-border p-3">
          <Link href="/admin" className="flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            <Shield className="size-4" aria-hidden />
            {t.dashboardNav.admin}
          </Link>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-surface">
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        {t.nav.skipToContent}
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border bg-background lg:block">{sidebar()}</aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-background/90 px-4 backdrop-blur md:px-6">
          <D.Root open={open} onOpenChange={setOpen}>
            <D.Trigger className="grid size-9 place-items-center rounded-md hover:bg-muted lg:hidden" aria-label={t.nav.openMenu}>
              <Menu className="size-5" aria-hidden />
            </D.Trigger>
            <SheetContent title="Dashboard navigation" className="w-72">
              {sidebar(() => setOpen(false))}
            </SheetContent>
          </D.Root>

          <div className="ml-auto flex items-center gap-1">
            {balanceLabel && (
              <Link href="/dashboard/wallet" className="mr-1 hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium tabular hover:border-primary/40 sm:inline-flex">
                <Wallet className="size-3.5 text-accent" aria-hidden />
                {balanceLabel}
              </Link>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger className="grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t.common.language}>
                <Languages className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {LOCALES.map((l) => (
                  <DropdownMenuItem key={l} onSelect={() => start(async () => { await setLocaleAction(l); router.refresh(); })}>
                    <span className="flex-1">{LOCALE_LABELS[l]}</span>
                    {locale === l && <Check className="!text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle />
            <Link
              href="/dashboard/notifications"
              className="relative grid size-9 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={unreadNotifications ? `${t.dashboardNav.notifications} (${unreadNotifications} unread)` : t.dashboardNav.notifications}
            >
              <Bell className="size-4" aria-hidden />
              {unreadNotifications > 0 && (
                <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground tabular">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger className="ml-1 rounded-full" aria-label="Account menu">
                <Avatar name={user.name} />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60">
                <div className="px-2.5 py-2">
                  <p className="truncate text-sm font-medium">{user.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings">
                    <User /> Profile and security
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/docs" target="_blank">
                    <Code2 /> API documentation
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => start(() => logoutAction())}>
                  <LogOut /> {t.common.signOut}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] p-4 md:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
