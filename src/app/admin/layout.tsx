import { AdminShell } from "@/components/admin/admin-shell";
import { TooltipProvider } from "@/components/ui/menu";
import { I18nProvider } from "@/i18n/client";
import { requirePlatform } from "@/lib/auth/session";
import { adminBadges } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { enabledOptInFeatures, laravelEnabled } from "@/lib/laravel/flags";

export const metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatform("admin:access");
  const b = await laravelPage(() => adminBadges());
  const { campaigns, senders, payments, tickets, abuse } = b;
  const extra: Record<string, number> = "topups" in b ? { topups: b.topups, unconfirmed: b.unconfirmed } : {};
  // Laravel-only admin pages: the opt-in modules, plus the admin API itself for unconfirmed messages / processing settings.
  const features = [...enabledOptInFeatures(), ...(laravelEnabled("admin") ? ["adminApi"] : [])];
  return (
    <I18nProvider locale="en">
      <TooltipProvider>
        <AdminShell user={{ name: session.user.name, email: session.user.email }} role={session.user.platformRole} badges={{ campaigns, senders, payments, tickets, abuse, ...extra }} features={features}>
          {children}
        </AdminShell>
      </TooltipProvider>
    </I18nProvider>
  );
}
