import { DashboardShell } from "@/components/dashboard/shell";
import { VerifyEmailBanner } from "@/components/dashboard/verify-email-banner";
import { Alert } from "@/components/ui/misc";
import { TooltipProvider } from "@/components/ui/menu";
import { I18nProvider } from "@/i18n/client";
import { getT } from "@/i18n/server";
import { requireTenant } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatBDT } from "@/lib/format";
import { laravelEnabled } from "@/lib/laravel/flags";
import { getLaravelMe } from "@/lib/laravel/session";

export const metadata = { title: "Dashboard", robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, ctx } = await requireTenant();
  const { locale } = await getT();
  const shell = laravelEnabled("auth") ? await shellFromLaravel(ctx.organizationId) : await shellFromPrisma(session.user.id, ctx);
  const { org } = shell;

  return (
    <I18nProvider locale={locale}>
      <TooltipProvider>
        <div lang={locale}>
          <DashboardShell
            user={{ name: session.user.name, email: session.user.email, isStaff: session.user.platformRole !== "USER" }}
            organization={{ id: ctx.organizationId, name: org.name, roleName: shell.roleName }}
            organizations={shell.organizations}
            permissions={ctx.permissions}
            unreadNotifications={shell.unread}
            balanceLabel={shell.balance !== null ? formatBDT(shell.balance, locale) : null}
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

interface ShellData {
  org: { name: string; status: string; suspendedReason: string | null };
  roleName: string;
  organizations: Array<{ id: string; name: string }>;
  unread: number;
  /** Decimal string, or null without billing:read. */
  balance: string | null;
}

/** Everything the shell needs comes with the (per-request cached) GET /auth/me. */
async function shellFromLaravel(organizationId: string): Promise<ShellData> {
  const me = await getLaravelMe();
  const org = me?.organization;
  if (!me || !org || org.id !== organizationId) throw new Error("Session changed during the request.");
  return {
    org: { name: org.name, status: org.status, suspendedReason: org.suspendedReason },
    roleName: me.organizations.find((o) => o.id === org.id)?.roleName ?? "",
    organizations: me.organizations.map((o) => ({ id: o.id, name: o.name })),
    unread: org.unreadNotifications,
    balance: org.balance,
  };
}

async function shellFromPrisma(userId: string, ctx: { organizationId: string; permissions: readonly string[] }): Promise<ShellData> {
  const [memberships, unread, wallet, org] = await Promise.all([
    db.organizationMember.findMany({
      where: { userId, status: "ACTIVE", organization: { deletedAt: null } },
      select: { organization: { select: { id: true, name: true } }, role: { select: { name: true } }, organizationId: true },
      orderBy: { joinedAt: "asc" },
    }),
    db.notification.count({ where: { userId, organizationId: ctx.organizationId, readAt: null } }),
    ctx.permissions.includes("billing:read") ? db.wallet.findUnique({ where: { organizationId: ctx.organizationId }, select: { balance: true } }) : null,
    db.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { name: true, status: true, suspendedReason: true } }),
  ]);
  const current = memberships.find((m) => m.organizationId === ctx.organizationId);
  return {
    org,
    roleName: current?.role.name ?? "",
    organizations: memberships.map((m) => m.organization),
    unread,
    balance: wallet ? wallet.balance.toString() : null,
  };
}
