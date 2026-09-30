import { AdminShell } from "@/components/admin/admin-shell";
import { TooltipProvider } from "@/components/ui/menu";
import { I18nProvider } from "@/i18n/client";
import { requirePlatform } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const metadata = { title: { default: "Admin", template: "%s | Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePlatform("admin:access");
  const [campaigns, senders, payments, tickets, abuse] = await Promise.all([
    db.campaign.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
    db.senderId.count({ where: { status: "PENDING" } }),
    db.payment.count({ where: { status: "AWAITING_VERIFICATION" } }),
    db.supportTicket.count({ where: { status: "OPEN" } }),
    db.abuseReport.count({ where: { status: "NEW" } }),
  ]);
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
