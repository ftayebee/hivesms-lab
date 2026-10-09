import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { AbuseReportStatus, LeadStatus, TicketStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { formatBDT, formatDateTime } from "@/lib/format";
import { revokeAllUserSessions } from "@/lib/auth/session-store";
import { creditWallet, debitWallet, ensureWallet } from "@/services/billing/wallet";
import { completePayment, failPayment } from "@/services/billing/payments";
import { notify } from "@/services/notify";
import { sendEmail } from "@/services/email";
import { emailTemplates } from "@/services/email/templates";
import { adminActor, confirmAdminPassword, type AdminContext } from "./guard";
import { uniqueViolationTarget } from "@/lib/db-errors";
import { normalizeBdPhone } from "@/lib/phone";
import { laravelEnabled } from "@/lib/laravel/flags";
import * as viaLaravel from "./laravel";

export const ADMIN_PAGE = 25;

// ─── Customers ───

export interface OrganizationFilters {
  /** Organization name or ID, member e-mail, name or BD mobile number. */
  q?: string;
  status?: "ACTIVE" | "SUSPENDED";
  /** Pricing plan id, or "none" for organizations on the default plan. */
  planId?: string;
  /** Registration date range, Dhaka calendar days (YYYY-MM-DD), inclusive. */
  from?: string;
  to?: string;
  review?: boolean;
  page: number;
  sort?: "newest" | "balance";
}

const dhakaDay = (d: string, addDays = 0) => new Date(new Date(`${d}T00:00:00+06:00`).getTime() + addDays * 86_400_000);

export async function listOrganizations(q: OrganizationFilters) {
  if (laravelEnabled("admin")) return viaLaravel.listOrganizations(q);
  const phone = q.q ? normalizeBdPhone(q.q) : null;
  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    ...(q.status ? { status: q.status } : {}),
    ...(q.planId ? { pricingPlanId: q.planId === "none" ? null : q.planId } : {}),
    ...(q.review ? { requireCampaignReview: true } : {}),
    ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: dhakaDay(q.from) } : {}), ...(q.to ? { lt: dhakaDay(q.to, 1) } : {}) } } : {}),
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q } },
            { id: q.q },
            { members: { some: { user: { OR: [{ email: { contains: q.q.toLowerCase() } }, { name: { contains: q.q } }, ...(phone ? [{ phone }] : [])] } } } },
          ],
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    db.organization.findMany({
      where,
      orderBy: q.sort === "balance" ? { wallet: { balance: "desc" } } : { createdAt: "desc" },
      skip: (q.page - 1) * ADMIN_PAGE,
      take: ADMIN_PAGE,
      include: { wallet: { select: { balance: true } }, pricingPlan: { select: { name: true } }, _count: { select: { members: true, messages: true } } },
    }),
    db.organization.count({ where }),
  ]);
  return { rows, total };
}

export async function getOrganizationDetail(id: string) {
  if (laravelEnabled("admin")) return viaLaravel.getOrganizationDetail(id);
  const org = await db.organization.findFirst({
    where: { id, deletedAt: null },
    include: {
      wallet: true,
      pricingPlan: true,
      members: { include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, status: true } }, role: { select: { name: true } } } },
      senderIds: { orderBy: { createdAt: "desc" } },
      campaigns: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 8 },
      payments: { orderBy: { createdAt: "desc" }, take: 8 },
      walletTransactions: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!org) throw notFound("Organization");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [sent30, failed30, audits] = await Promise.all([
    db.message.count({ where: { organizationId: id, createdAt: { gte: since } } }),
    db.message.count({ where: { organizationId: id, createdAt: { gte: since }, status: { in: ["FAILED", "REJECTED", "EXPIRED"] } } }),
    db.auditLog.findMany({ where: { organizationId: id }, orderBy: { createdAt: "desc" }, take: 15, include: { actor: { select: { name: true } } } }),
  ]);
  return { org, sent30, failed30, audits };
}

export const orgControlsSchema = z.object({
  dailySendLimit: z.coerce.number().int().min(0).max(10_000_000),
  monthlySendLimit: z.coerce.number().int().min(0).max(100_000_000),
  requireCampaignReview: z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean()),
  pricingPlanId: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
});

export async function updateOrganizationControls(admin: AdminContext, id: string, input: z.infer<typeof orgControlsSchema>) {
  if (laravelEnabled("admin")) return viaLaravel.updateOrganizationControls(id, input);
  const before = await db.organization.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound("Organization");
  if (input.monthlySendLimit < input.dailySendLimit) throw new AppError("VALIDATION_ERROR", "The monthly limit must be at least the daily limit.", { field: "monthlySendLimit" });
  await db.organization.update({ where: { id }, data: input });
  await audit({
    action: "admin.organization.controls_update",
    actor: adminActor(admin),
    organizationId: id,
    targetType: "organization",
    targetId: id,
    ip: admin.ip,
    metadata: { before: { daily: before.dailySendLimit, monthly: before.monthlySendLimit, review: before.requireCampaignReview, plan: before.pricingPlanId }, after: input },
  });
}

export async function setOrganizationStatus(admin: AdminContext, id: string, status: "ACTIVE" | "SUSPENDED", reason: string | null) {
  if (laravelEnabled("admin")) return viaLaravel.setOrganizationStatus(id, status, reason);
  const org = await db.organization.findFirst({ where: { id, deletedAt: null } });
  if (!org) throw notFound("Organization");
  if (!reason) throw new AppError("VALIDATION_ERROR", status === "SUSPENDED" ? "Give a reason for the suspension." : "Give a reason for reactivating the account.", { field: "reason" });
  await db.organization.update({ where: { id }, data: { status, suspendedReason: status === "SUSPENDED" ? reason : null } });
  if (status === "SUSPENDED") {
    // Stop anything scheduled from starting; queued messages are held by the dispatcher.
    // API keys stay in place but are rejected while the organization is suspended.
    await db.campaign.updateMany({ where: { organizationId: id, status: { in: ["SCHEDULED", "PROCESSING"] } }, data: { status: "PAUSED", pausedAt: new Date() } });
  }
  await audit({ action: status === "SUSPENDED" ? "admin.organization.suspend" : "admin.organization.activate", actor: adminActor(admin), organizationId: id, targetType: "organization", targetId: id, ip: admin.ip, metadata: { reason } });
}

export const walletAdjustSchema = z.object({
  direction: z.enum(["CREDIT", "DEBIT"]),
  // Plain decimal string (no floats, no exponent notation), up to 2 decimals.
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,8}(\.\d{1,2})?$/, "Enter an amount greater than 0 (up to 2 decimals).")
    .refine((v) => Number(v) > 0, "Enter an amount greater than 0 (up to 2 decimals)."),
  note: z.string().trim().min(5, "Explain the adjustment (visible to the customer).").max(300),
  // Generated when the form is rendered: a double submit or retry applies the adjustment once.
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/, "Missing request key. Reload the page and try again."),
  currentPassword: z.string().min(1, "Confirm with your current password.").max(200),
});

/**
 * Manual credit/debit (super admin only, password re-confirmed, idempotent). Laravel path:
 * FinanceService::adjust. Prisma path (rollback): same rules — the idempotency key is the unique
 * ledger reference, so a replay returns the first result and never applies twice.
 */
export async function adjustWallet(admin: AdminContext, orgId: string, input: z.infer<typeof walletAdjustSchema>): Promise<{ replayed: boolean }> {
  if (laravelEnabled("admin")) return viaLaravel.adjustWallet(orgId, input);
  await confirmAdminPassword(admin, input.currentPassword);
  const ref = { reason: "ADJUSTMENT" as const, referenceType: "admin_adjustment", referenceId: input.idempotencyKey };
  const replay = async () => {
    const tx = await db.walletTransaction.findFirst({ where: ref });
    if (!tx) return null;
    if (tx.organizationId !== orgId || tx.type !== input.direction || !tx.amount.equals(input.amount)) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "This idempotency key was already used for a different adjustment.");
    }
    return { replayed: true };
  };
  const first = await replay();
  if (first) return first;
  await ensureWallet(orgId);
  try {
    await db.$transaction(async (tx) => {
      const entry = { organizationId: orgId, amount: input.amount, ...ref, description: `Adjustment: ${input.note}`, createdById: admin.userId };
      if (input.direction === "CREDIT") await creditWallet(tx, entry);
      else await debitWallet(tx, entry);
      await audit({ action: "admin.wallet.adjust", actor: adminActor(admin), organizationId: orgId, targetType: "wallet", targetId: orgId, ip: admin.ip, metadata: { direction: input.direction, amount: input.amount, reason: input.note } }, tx);
    });
  } catch (err) {
    if (uniqueViolationTarget(err)) return (await replay()) ?? { replayed: true };
    throw err;
  }
  return { replayed: false };
}

// ─── Campaign review ───

export async function listCampaignsForAdmin(q: { status?: string; page: number }) {
  if (laravelEnabled("admin")) return viaLaravel.listCampaigns(q);
  const where: Prisma.CampaignWhereInput = { deletedAt: null, ...(q.status ? { status: q.status as never } : {}) };
  const [rows, total] = await Promise.all([
    db.campaign.findMany({ where, orderBy: q.status === "PENDING_REVIEW" ? { createdAt: "asc" } : { createdAt: "desc" }, skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { organization: { select: { id: true, name: true, createdAt: true } } } }),
    db.campaign.count({ where }),
  ]);
  return { rows, total };
}

export async function reviewCampaign(admin: AdminContext, id: string, decision: "approve" | "reject", reason: string | null) {
  if (laravelEnabled("admin")) return viaLaravel.reviewCampaign(id, decision, reason);
  const c = await db.campaign.findFirst({ where: { id, status: "PENDING_REVIEW" } });
  if (!c) throw new AppError("CONFLICT", "This campaign is not waiting for review.");
  if (decision === "reject" && !reason) throw new AppError("VALIDATION_ERROR", "Give the customer a reason.", { field: "reason" });
  const scheduledAt = c.scheduledAt && c.scheduledAt > new Date() ? c.scheduledAt : null;
  await db.campaign.update({
    where: { id },
    data: decision === "approve" ? { status: "SCHEDULED", scheduledAt, reviewedAt: new Date(), reviewedById: admin.userId } : { status: "CANCELLED", cancelledAt: new Date(), reviewedAt: new Date(), reviewedById: admin.userId, reviewNote: reason },
  });
  await audit({ action: decision === "approve" ? "campaign.approve" : "campaign.reject", actor: adminActor(admin), organizationId: c.organizationId, targetType: "campaign", targetId: id, ip: admin.ip, metadata: { reason } });
  await notify({
    organizationId: c.organizationId,
    type: "campaign.review",
    title: decision === "approve" ? `Campaign "${c.name}" approved` : `Campaign "${c.name}" was not approved`,
    body: decision === "approve" ? (scheduledAt ? `It will send at ${formatDateTime(scheduledAt)}.` : "Sending is starting now.") : `Reason: ${reason}`,
    link: `/dashboard/campaigns/${id}`,
  });
  return { launchNow: decision === "approve" && !scheduledAt };
}

// ─── Sender IDs ───

export async function listSenderIdsForAdmin(q: { status?: string; page: number }) {
  if (laravelEnabled("admin")) return viaLaravel.listSenderIds(q);
  const where: Prisma.SenderIdWhereInput = q.status ? { status: q.status as never } : {};
  const [rows, total] = await Promise.all([
    db.senderId.findMany({ where, orderBy: q.status === "PENDING" ? { createdAt: "asc" } : { updatedAt: "desc" }, skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { organization: { select: { id: true, name: true, pricingPlan: { select: { senderIdFee: true } } } } } }),
    db.senderId.count({ where }),
  ]);
  return { rows, total };
}

export async function reviewSenderId(admin: AdminContext, id: string, decision: "APPROVED" | "REJECTED" | "SUSPENDED", reason: string | null, providerRef: string | null) {
  if (laravelEnabled("admin")) return viaLaravel.reviewSenderId(id, decision, reason, providerRef);
  const s = await db.senderId.findUnique({ where: { id }, include: { organization: { include: { pricingPlan: true } } } });
  if (!s) throw notFound("Sender ID");
  if (decision !== "APPROVED" && !reason) throw new AppError("VALIDATION_ERROR", "Give the customer a reason.", { field: "reason" });
  if (decision === "APPROVED" && s.status !== "PENDING" && s.status !== "SUSPENDED") throw new AppError("CONFLICT", "Only pending or suspended sender IDs can be approved.");
  await db.$transaction(async (tx) => {
    const fee = s.organization.pricingPlan?.senderIdFee;
    if (decision === "APPROVED" && s.status === "PENDING" && fee && Number(fee) > 0) {
      await debitWallet(tx, { organizationId: s.organizationId, amount: fee.toString(), reason: "SENDER_ID_FEE", description: `Sender ID fee: ${s.value}`, referenceType: "sender_id", referenceId: s.id, createdById: admin.userId });
    }
    const hasDefault = await tx.senderId.count({ where: { organizationId: s.organizationId, status: "APPROVED", isDefault: true, id: { not: s.id } } });
    await tx.senderId.update({
      where: { id },
      data: {
        status: decision,
        rejectionReason: decision === "APPROVED" ? null : reason,
        reviewedAt: new Date(),
        reviewedById: admin.userId,
        ...(decision === "APPROVED" ? { approvedAt: s.approvedAt ?? new Date(), providerRef: providerRef ?? s.providerRef, isDefault: s.isDefault || hasDefault === 0 } : { isDefault: false }),
      },
    });
    await audit({ action: `admin.sender_id.${decision.toLowerCase()}`, actor: adminActor(admin), organizationId: s.organizationId, targetType: "sender_id", targetId: id, ip: admin.ip, metadata: { value: s.value, reason } }, tx);
  });
  await notify({
    organizationId: s.organizationId,
    type: "sender_id.status",
    title: decision === "APPROVED" ? `Sender ID ${s.value} approved` : decision === "REJECTED" ? `Sender ID ${s.value} was not approved` : `Sender ID ${s.value} suspended`,
    body: decision === "APPROVED" ? "You can now use it when sending." : `Reason: ${reason}`,
    link: "/dashboard/sender-ids",
    email: (to) => emailTemplates.senderIdStatus(to, { value: s.value, status: decision, reason }),
  });
}

// ─── Payments ───

export async function listPaymentsForAdmin(q: { status?: string; page: number }) {
  if (laravelEnabled("admin")) return viaLaravel.listPayments(q);
  const where: Prisma.PaymentWhereInput = q.status ? { status: q.status as never } : {};
  const [rows, total] = await Promise.all([
    db.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { organization: { select: { id: true, name: true } }, invoice: { select: { number: true } } } }),
    db.payment.count({ where }),
  ]);
  return { rows, total };
}

export async function reviewManualPayment(admin: AdminContext, id: string, decision: "approve" | "reject", reason: string | null) {
  if (laravelEnabled("admin")) return viaLaravel.reviewManualPayment(id, decision, reason);
  const p = await db.payment.findUnique({ where: { id } });
  if (!p) throw notFound("Payment");
  if (p.provider !== "manual") throw new AppError("VALIDATION_ERROR", "Only manual payments are verified here.");
  if (decision === "approve") {
    await completePayment(id, { providerRef: p.manualReference ? `MANUAL-${p.manualReference}` : null, actor: adminActor(admin), note: reason ?? "verified by admin" });
  } else {
    if (!reason) throw new AppError("VALIDATION_ERROR", "Give the customer a reason.", { field: "reason" });
    const ok = await failPayment(id, reason, adminActor(admin));
    if (!ok) throw new AppError("CONFLICT", "This payment is no longer pending.");
  }
}

// ─── Support ───

export async function listTicketsForAdmin(q: { status?: TicketStatus; mine?: string; page: number }) {
  if (laravelEnabled("admin")) return viaLaravel.listTickets({ status: q.status, mine: Boolean(q.mine), page: q.page });
  const where: Prisma.SupportTicketWhereInput = { ...(q.status ? { status: q.status } : { status: { not: "CLOSED" } }), ...(q.mine ? { assignedToId: q.mine } : {}) };
  const [rows, total] = await Promise.all([
    db.supportTicket.findMany({
      where,
      orderBy: [{ priority: "desc" }, { lastReplyAt: "asc" }],
      skip: (q.page - 1) * ADMIN_PAGE,
      take: ADMIN_PAGE,
      include: { organization: { select: { id: true, name: true } }, assignedTo: { select: { name: true } }, createdBy: { select: { name: true } } },
    }),
    db.supportTicket.count({ where }),
  ]);
  return { rows, total };
}

export async function getTicketForAdmin(id: string) {
  if (laravelEnabled("admin")) return viaLaravel.getTicket(id);
  const t = await db.supportTicket.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true } },
      createdBy: { select: { name: true, email: true } },
      assignedTo: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!t) throw notFound("Ticket");
  return t;
}

export const staffReplySchema = z.object({
  body: z.string().trim().min(1, "Write a reply.").max(10_000),
  internal: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).default(false),
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]).optional(),
});

export async function staffReply(admin: AdminContext, id: string, input: z.infer<typeof staffReplySchema>) {
  if (laravelEnabled("admin")) return viaLaravel.staffReply(id, input);
  const t = await db.supportTicket.findUnique({ where: { id }, include: { createdBy: { select: { email: true, id: true } } } });
  if (!t) throw notFound("Ticket");
  const status = input.status ?? (input.internal ? t.status : "WAITING_FOR_CUSTOMER");
  await db.$transaction([
    db.supportMessage.create({ data: { ticketId: id, authorId: admin.userId, body: input.body, isStaff: true, isInternal: input.internal } }),
    db.supportTicket.update({ where: { id }, data: { status, ...(input.internal ? {} : { lastReplyAt: new Date() }), assignedToId: t.assignedToId ?? admin.userId, ...(status === "CLOSED" ? { closedAt: new Date() } : {}) } }),
  ]);
  await audit({ action: input.internal ? "admin.support.note" : "admin.support.reply", actor: adminActor(admin), organizationId: t.organizationId, targetType: "ticket", targetId: id, ip: admin.ip, metadata: { status } });
  if (!input.internal) {
    const statusLabel = status.replace(/_/g, " ").toLowerCase();
    await notify({
      organizationId: t.organizationId,
      type: "support.updated",
      userIds: [t.createdBy.id],
      title: `Reply on ticket #${t.number}`,
      body: input.body.slice(0, 140),
      link: `/dashboard/support/${id}`,
      email: (to) => emailTemplates.supportTicketUpdate(to, { number: t.number, subject: t.subject, status: statusLabel, excerpt: input.body.slice(0, 500), ticketId: id }),
    });
  }
}

export async function setTicketStatus(admin: AdminContext, id: string, status: TicketStatus, assignToMe: boolean) {
  if (laravelEnabled("admin")) return viaLaravel.setTicketStatus(id, status, assignToMe);
  const t = await db.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound("Ticket");
  await db.supportTicket.update({ where: { id }, data: { status, ...(assignToMe ? { assignedToId: admin.userId } : {}), ...(status === "CLOSED" ? { closedAt: new Date() } : {}) } });
  await audit({ action: "admin.support.status", actor: adminActor(admin), organizationId: t.organizationId, targetType: "ticket", targetId: id, metadata: { status, assignToMe } });
}

// ─── Users (platform) ───

export async function listUsers(q: { q?: string; role?: string; page: number }) {
  if (laravelEnabled("admin")) return viaLaravel.listUsers(q);
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(q.role ? { platformRole: q.role as never } : {}),
    ...(q.q ? { OR: [{ email: { contains: q.q.toLowerCase() } }, { name: { contains: q.q } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { memberships: { include: { organization: { select: { id: true, name: true } } } } } }),
    db.user.count({ where }),
  ]);
  return { rows, total };
}

export interface UserAccessInput {
  platformRole?: "USER" | "SUPPORT" | "ADMIN" | "SUPER_ADMIN";
  status?: "ACTIVE" | "SUSPENDED";
  reason: string;
  currentPassword: string;
}

/**
 * Staff access change (super admin only; Laravel path: StaffService). Never on yourself; the last
 * active super admin can be neither demoted nor suspended (owner rows locked first); reason and
 * password confirmation are required; audited with before/after; the user is signed out.
 */
export async function updateUserAccess(admin: AdminContext, userId: string, input: UserAccessInput) {
  if (userId === admin.userId) throw new AppError("FORBIDDEN", "You can't change your own access.");
  if (laravelEnabled("admin")) return viaLaravel.updateUserAccess(userId, input);
  await confirmAdminPassword(admin, input.currentPassword);
  const after = { ...(input.platformRole ? { platformRole: input.platformRole } : {}), ...(input.status ? { status: input.status } : {}) };
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE platformRole = 'SUPER_ADMIN' AND status = 'ACTIVE' FOR UPDATE`;
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) throw notFound("User");
    const losesOwner = u.platformRole === "SUPER_ADMIN" && u.status === "ACTIVE" && ((input.platformRole && input.platformRole !== "SUPER_ADMIN") || input.status === "SUSPENDED");
    if (losesOwner && (await tx.user.count({ where: { platformRole: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null } })) <= 1) {
      throw new AppError("CONFLICT", "At least one active super admin must remain. Promote a replacement first.");
    }
    await tx.user.update({ where: { id: userId }, data: after });
    await audit({ action: "admin.user.access_update", actor: adminActor(admin), targetType: "user", targetId: userId, ip: admin.ip, userAgent: admin.userAgent, metadata: { before: { platformRole: u.platformRole, status: u.status }, after, reason: input.reason } }, tx);
  });
  if (input.status === "SUSPENDED" || input.platformRole) await revokeAllUserSessions(userId);
}

// ─── Abuse reports & leads ───

export async function setAbuseStatus(admin: AdminContext, id: string, status: AbuseReportStatus, note: string | null) {
  if (laravelEnabled("admin")) return viaLaravel.setAbuseStatus(id, status, note);
  const r = await db.abuseReport.update({ where: { id }, data: { status, resolutionNote: note, handledById: admin.userId } });
  await audit({ action: "admin.abuse.update", actor: adminActor(admin), organizationId: r.organizationId, targetType: "abuse_report", targetId: id, metadata: { status } });
}

export async function setLeadStatus(admin: AdminContext, id: string, status: LeadStatus) {
  if (laravelEnabled("admin")) return viaLaravel.setLeadStatus(id, status);
  await db.contactRequest.update({ where: { id }, data: { status } });
  await audit({ action: "admin.lead.update", actor: adminActor(admin), targetType: "contact_request", targetId: id, metadata: { status } });
}

export function describeMoney(v: { toString(): string }) {
  return formatBDT(v.toString());
}

export async function sendAdminTestEmail(admin: AdminContext, to: string) {
  return sendEmail({ to, subject: "SMSFlow BD test email", text: `Test email sent by ${admin.name}.`, html: `<p>Test email sent by ${admin.name}.</p>`, tag: "admin-test" });
}
