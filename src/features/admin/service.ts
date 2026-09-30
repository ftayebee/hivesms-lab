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
import { adminActor, type AdminContext } from "./guard";

export const ADMIN_PAGE = 25;

// ─── Customers ───

export async function listOrganizations(q: { q?: string; status?: "ACTIVE" | "SUSPENDED"; page: number; sort?: "newest" | "balance" }) {
  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    ...(q.status ? { status: q.status } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q } }, { members: { some: { user: { email: { contains: q.q.toLowerCase() } } } } }] } : {}),
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
  const org = await db.organization.findFirst({ where: { id, deletedAt: null } });
  if (!org) throw notFound("Organization");
  if (status === "SUSPENDED" && !reason) throw new AppError("VALIDATION_ERROR", "Give a reason for the suspension.", { field: "reason" });
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
  amount: z.coerce.number().positive("Enter an amount.").max(10_000_000),
  note: z.string().trim().min(5, "Explain the adjustment (visible to the customer).").max(300),
});

export async function adjustWallet(admin: AdminContext, orgId: string, input: z.infer<typeof walletAdjustSchema>) {
  await ensureWallet(orgId);
  const reference = crypto.randomUUID();
  await db.$transaction(async (tx) => {
    const entry = { organizationId: orgId, amount: input.amount.toFixed(2), reason: "ADJUSTMENT" as const, description: `Adjustment: ${input.note}`, referenceType: "admin_adjustment", referenceId: reference, createdById: admin.userId };
    if (input.direction === "CREDIT") await creditWallet(tx, entry);
    else await debitWallet(tx, entry);
    await audit({ action: "admin.wallet.adjust", actor: adminActor(admin), organizationId: orgId, targetType: "wallet", targetId: orgId, ip: admin.ip, metadata: { direction: input.direction, amount: input.amount, note: input.note } }, tx);
  });
}

// ─── Campaign review ───

export async function listCampaignsForAdmin(q: { status?: string; page: number }) {
  const where: Prisma.CampaignWhereInput = { deletedAt: null, ...(q.status ? { status: q.status as never } : {}) };
  const [rows, total] = await Promise.all([
    db.campaign.findMany({ where, orderBy: q.status === "PENDING_REVIEW" ? { createdAt: "asc" } : { createdAt: "desc" }, skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { organization: { select: { id: true, name: true, createdAt: true } } } }),
    db.campaign.count({ where }),
  ]);
  return { rows, total };
}

export async function reviewCampaign(admin: AdminContext, id: string, decision: "approve" | "reject", reason: string | null) {
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
  const where: Prisma.SenderIdWhereInput = q.status ? { status: q.status as never } : {};
  const [rows, total] = await Promise.all([
    db.senderId.findMany({ where, orderBy: q.status === "PENDING" ? { createdAt: "asc" } : { updatedAt: "desc" }, skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { organization: { select: { id: true, name: true, pricingPlan: { select: { senderIdFee: true } } } } } }),
    db.senderId.count({ where }),
  ]);
  return { rows, total };
}

export async function reviewSenderId(admin: AdminContext, id: string, decision: "APPROVED" | "REJECTED" | "SUSPENDED", reason: string | null, providerRef: string | null) {
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
  const where: Prisma.PaymentWhereInput = q.status ? { status: q.status as never } : {};
  const [rows, total] = await Promise.all([
    db.payment.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, include: { organization: { select: { id: true, name: true } }, invoice: { select: { number: true } } } }),
    db.payment.count({ where }),
  ]);
  return { rows, total };
}

export async function reviewManualPayment(admin: AdminContext, id: string, decision: "approve" | "reject", reason: string | null) {
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
  const t = await db.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound("Ticket");
  await db.supportTicket.update({ where: { id }, data: { status, ...(assignToMe ? { assignedToId: admin.userId } : {}), ...(status === "CLOSED" ? { closedAt: new Date() } : {}) } });
  await audit({ action: "admin.support.status", actor: adminActor(admin), organizationId: t.organizationId, targetType: "ticket", targetId: id, metadata: { status, assignToMe } });
}

// ─── Users (platform) ───

export async function listUsers(q: { q?: string; role?: string; page: number }) {
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

export async function updateUserAccess(admin: AdminContext, userId: string, input: { platformRole?: "USER" | "SUPPORT" | "ADMIN" | "SUPER_ADMIN"; status?: "ACTIVE" | "SUSPENDED" }) {
  if (userId === admin.userId) throw new AppError("FORBIDDEN", "You can't change your own access.");
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) throw notFound("User");
  if (input.platformRole && u.platformRole === "SUPER_ADMIN" && input.platformRole !== "SUPER_ADMIN") {
    const supers = await db.user.count({ where: { platformRole: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null } });
    if (supers <= 1) throw new AppError("CONFLICT", "At least one super admin must remain.");
  }
  await db.user.update({ where: { id: userId }, data: input });
  if (input.status === "SUSPENDED" || input.platformRole) await revokeAllUserSessions(userId);
  await audit({ action: "admin.user.access_update", actor: adminActor(admin), targetType: "user", targetId: userId, ip: admin.ip, metadata: { before: { role: u.platformRole, status: u.status }, after: input } });
}

// ─── Abuse reports & leads ───

export async function setAbuseStatus(admin: AdminContext, id: string, status: AbuseReportStatus, note: string | null) {
  const r = await db.abuseReport.update({ where: { id }, data: { status, resolutionNote: note, handledById: admin.userId } });
  await audit({ action: "admin.abuse.update", actor: adminActor(admin), organizationId: r.organizationId, targetType: "abuse_report", targetId: id, metadata: { status } });
}

export async function setLeadStatus(admin: AdminContext, id: string, status: LeadStatus) {
  await db.contactRequest.update({ where: { id }, data: { status } });
  await audit({ action: "admin.lead.update", actor: adminActor(admin), targetType: "contact_request", targetId: id, metadata: { status } });
}

export function describeMoney(v: { toString(): string }) {
  return formatBDT(v.toString());
}

export async function sendAdminTestEmail(admin: AdminContext, to: string) {
  return sendEmail({ to, subject: "SMSFlow BD test email", text: `Test email sent by ${admin.name}.`, html: `<p>Test email sent by ${admin.name}.</p>`, tag: "admin-test" });
}
