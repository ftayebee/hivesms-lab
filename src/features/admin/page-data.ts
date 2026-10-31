import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { MessageStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizeBdPhone } from "@/lib/phone";
import { laravelEnabled } from "@/lib/laravel/flags";
import { getBillingPolicy, getPaymentSettings, getSiteContent, getSmsPolicy, getSmsProviderSettings, listSecretStatus } from "@/services/settings";
import { siteConfig } from "@/config/site";
import { getAdminOverview } from "./overview";
import * as viaLaravel from "./laravel";

/**
 * Data of the admin pages that used to query Prisma directly. With LARAVEL_FEATURES `admin` every
 * read goes to the Laravel admin API (platform permission enforced there); otherwise Prisma.
 */

export async function adminBadges() {
  if (laravelEnabled("admin")) return viaLaravel.badges();
  const [campaigns, senders, payments, tickets, abuse] = await Promise.all([
    db.campaign.count({ where: { status: "PENDING_REVIEW", deletedAt: null } }),
    db.senderId.count({ where: { status: "PENDING" } }),
    db.payment.count({ where: { status: "AWAITING_VERIFICATION" } }),
    db.supportTicket.count({ where: { status: "OPEN" } }),
    db.abuseReport.count({ where: { status: "NEW" } }),
  ]);
  return { campaigns, senders, payments, tickets, abuse };
}

export async function adminOverviewPage() {
  if (laravelEnabled("admin")) {
    const { overview, smsProvider } = await viaLaravel.overview();
    return { o: overview, providerKey: smsProvider };
  }
  const [o, provider] = await Promise.all([getAdminOverview(), getSmsProviderSettings()]);
  return { o, providerKey: provider.provider as string };
}

export async function abusePage() {
  if (laravelEnabled("admin")) return viaLaravel.abusePageData();
  const [reports, leads, blocklist] = await Promise.all([
    db.abuseReport.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 50 }),
    db.contactRequest.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.blocklistEntry.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const orgNames = new Map(
    (await db.organization.findMany({ where: { id: { in: reports.map((r) => r.organizationId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]),
  );
  return { reports, leads, blocklist, orgNames };
}

export async function apiLogsPage(q: { status?: "4xx" | "5xx"; page: number }) {
  if (laravelEnabled("admin")) return viaLaravel.listApiLogs(q);
  const where: Prisma.ApiLogWhereInput = q.status === "4xx" ? { statusCode: { gte: 400, lt: 500 } } : q.status === "5xx" ? { statusCode: { gte: 500 } } : {};
  const [rows, total] = await Promise.all([
    db.apiLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * 40, take: 40, include: { organization: { select: { id: true, name: true } }, apiKey: { select: { prefix: true } } } }),
    db.apiLog.count({ where }),
  ]);
  return { rows, total, pageSize: 40 };
}

export async function auditLogsPage(q: { action: string; org?: string; page: number }) {
  if (laravelEnabled("admin")) return viaLaravel.listAuditLogs({ action: q.action || undefined, organizationId: q.org, page: q.page });
  const where: Prisma.AuditLogWhereInput = { ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.org ? { organizationId: q.org } : {}) };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * 50, take: 50, include: { actor: { select: { name: true, email: true } }, organization: { select: { id: true, name: true } } } }),
    db.auditLog.count({ where }),
  ]);
  return { rows, total, pageSize: 50 };
}

/** Recipient searches are audited (by Laravel when switched). */
export async function messagesPage(q: { to: string; status?: MessageStatus; provider?: string; page: number }, adminUserId: string) {
  if (laravelEnabled("admin")) return viaLaravel.listMessages({ to: q.to || undefined, status: q.status, provider: q.provider, page: q.page });
  const where: Prisma.MessageWhereInput = {
    ...(q.to ? { to: normalizeBdPhone(q.to) ?? q.to } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.provider ? { providerMessageId: q.provider } : {}),
  };
  const [rows, total] = await Promise.all([
    db.message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * 30, take: 30, include: { organization: { select: { id: true, name: true } } } }),
    db.message.count({ where }),
  ]);
  if (q.to) await audit({ action: "admin.messages.search", actor: { type: "ADMIN", userId: adminUserId }, metadata: { recipient: q.to.slice(0, 20) } });
  return { rows, total, pageSize: 30 };
}

export async function walletsPage(page: number) {
  if (laravelEnabled("admin")) {
    const w = await viaLaravel.listWallets(page);
    return { rows: w.rows, total: w.total, pageSize: w.pageSize, sum: w.totalBalance, low: w.belowThreshold };
  }
  const [rows, total, sum, low] = await Promise.all([
    db.wallet.findMany({ orderBy: { balance: "desc" }, skip: (page - 1) * 25, take: 25, include: { organization: { select: { id: true, name: true, status: true } } } }),
    db.wallet.count(),
    db.wallet.aggregate({ _sum: { balance: true } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM wallets WHERE balance < lowBalanceThreshold`,
  ]);
  return { rows, total, pageSize: 25, sum: sum._sum.balance ?? 0, low: Number(low[0]?.n ?? 0) };
}

export async function pricingPage() {
  if (laravelEnabled("admin")) return viaLaravel.pricingPageData();
  const [plans, packages, policy] = await Promise.all([db.pricingPlan.findMany({ orderBy: { sortOrder: "asc" } }), db.creditPackage.findMany({ orderBy: { sortOrder: "asc" } }), getBillingPolicy()]);
  return { plans, packages, policy };
}

export async function settingsPage() {
  if (laravelEnabled("admin")) {
    const s = await viaLaravel.settingsPageData();
    const contact = s.siteContent.contact ?? {};
    return {
      provider: s.smsProvider,
      secrets: s.secrets as Awaited<ReturnType<typeof listSecretStatus>>,
      policy: s.smsPolicy,
      payments: s.payments,
      site: {
        contact,
        announcement: s.siteContent.announcement,
        contactResolved: { ...siteConfig.contact, ...Object.fromEntries(Object.entries(contact).filter(([, v]) => v !== "" && v != null)) },
      },
    };
  }
  const [provider, secrets, policy, payments, site] = await Promise.all([getSmsProviderSettings(), listSecretStatus(), getSmsPolicy(), getPaymentSettings(), getSiteContent()]);
  return { provider, secrets, policy, payments, site };
}

/** Plans for the account-controls form; only pricing managers can change a customer's plan. */
export async function plansForControls(canManagePricing: boolean) {
  if (laravelEnabled("admin")) return canManagePricing ? viaLaravel.activePlans() : [];
  return db.pricingPlan.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
}
