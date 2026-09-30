import { DashboardShell } from "@/components/dashboard/shell";
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { Alert } from "@/components/ui/misc";
import { TooltipProvider } from "@/components/ui/menu";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { requireTenant } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatBDT } from "@/lib/format";

export const metadata = { title: "Dashboard", robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx } = await requireTenant();
  const { locale } = await getT();
  const [memberships, unread, wallet, org] = await Promise.all([
    db.organizationMember.findMany({
      where: { userId: session.user.id, status: "ACTIVE", organization: { deletedAt: null } },
      select: { organization: { select: { id: true, name: true } }, role: { select: { name: true } }, organizationId: true },
      orderBy: { joinedAt: "asc" },
    }),
    db.notification.count({ where: { userId: session.user.id, organizationId: ctx.organizationId, readAt: null } }),
    ctx.permissions.includes("billing:read") ? db.wallet.findUnique({ where: { organizationId: ctx.organizationId }, select: { balance: true } }) : null,
    db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true, status: true, suspendedReason: true } }),
  ]);
  const current = memberships.find((m) => m.organizationId === ctx.organizationId);

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <div lang={locale}>
          <DashboardShell
            user={{ name: session.user.name, email: session.user.email, isStaff: session.user.platformRole !== "USER" }}
            organization={{ id: ctx.organizationId, name: org.name, roleName: current?.role.name ?? "" }}
            organizations={memberships.map((m) => m.organization)}
            permissions={ctx.permissions}
            unreadNotifications={unread}
            balanceLabel={wallet ? formatBDT(wallet.balance.toString(), locale) : null}
          >
            {org.status === "SUSPENDED" && (
              <Alert tone="danger" className="mb-6" title="This account is suspended">
                Sending is disabled. {org.suspendedReason ? `Reason: ${org.suspendedReason}. ` : ""}Contact support to restore access.
              </Alert>
            )}
            {!session.user.emailVerifiedAt && <VerifyEmailBanner email={session.user.email} />}
            {children}
          </DashboardShell>
        </div>
      </TooltipProvider>
    </I18nProvider>
  );
}
