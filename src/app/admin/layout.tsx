import { AdminShell } from "@/components/admin/admin-shell";
import { TooltipProvider } from "@/components/ui/menu";
import { I18nProvider } from "@/i18n/client";
import { requirePlatform } from "@/lib/auth/session";
import { adminBadges } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";

export const metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatform("admin:access");
  const { campaigns, senders, payments, tickets, abuse } = await laravelPage(() => adminBadges());
  return (
    <I18nProvider locale="en">
      <TooltipProvider>
        <AdminShell user={{ name: session.user.name, email: session.user.email }} role={session.user.platformRole} badges={{ campaigns, senders, payments, tickets, abuse }}>
          {children}
        </AdminShell>
      </TooltipProvider>
    </I18nProvider>
  );
}
