import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { TicketStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, requirePermission, type TenantContext } from "@/lib/auth/context";

export const TICKET_CATEGORIES = ["General", "Billing", "Sender ID", "Delivery", "API / integration", "Account", "Abuse / compliance"] as const;

export const ticketSchema = z.object({
  subject: z.string().trim().min(5, "Describe the issue in a few words.").max(150),
  category: z.enum(TICKET_CATEGORIES),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  message: z.string().trim().min(10, "Add some detail (at least 10 characters).").max(10_000),
});

export const replySchema = z.object({ body: z.string().trim().min(1, "Write a reply.").max(10_000) });

export const TICKET_PAGE = 20;

export async function listTickets(ctx: TenantContext, opts: { status?: TicketStatus; page: number }) {
  requirePermission(ctx, "support:read");
  const where: Prisma.SupportTicketWhereInput = { organizationId: ctx.organizationId, ...(opts.status ? { status: opts.status } : {}) };
  const [rows, total] = await Promise.all([
    db.supportTicket.findMany({ where, orderBy: { lastReplyAt: "desc" }, skip: (opts.page - 1) * TICKET_PAGE, take: TICKET_PAGE, include: { createdBy: { select: { name: true } }, _count: { select: { messages: { where: { isInternal: false } } } } } }),
    db.supportTicket.count({ where }),
  ]);
  return { rows, total };
}

export async function createTicket(ctx: TenantContext, input: z.infer<typeof ticketSchema>) {
  requirePermission(ctx, "support:write");
  const open = await db.supportTicket.count({ where: { organizationId: ctx.organizationId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER"] } } });
  if (open >= 30) throw new AppError("VALIDATION_ERROR", "You have many open tickets. Reply on an existing ticket or close resolved ones.");
  const t = await db.supportTicket.create({
    data: {
      organizationId: ctx.organizationId,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      createdById: ctx.userId!,
      messages: { create: { authorId: ctx.userId!, body: input.message } },
    },
  });
  await audit({ action: "support.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "ticket", targetId: t.id, metadata: { number: t.number, priority: input.priority } });
  return t;
}

export async function getTicket(ctx: TenantContext, id: string) {
  requirePermission(ctx, "support:read");
  const t = await db.supportTicket.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      createdBy: { select: { name: true } },
      // Internal staff notes are never returned to customers.
      messages: { where: { isInternal: false }, orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!t) throw notFound("Ticket");
  return t;
}

export async function replyToTicket(ctx: TenantContext, id: string, body: string) {
  requirePermission(ctx, "support:write");
  const t = await db.supportTicket.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!t) throw notFound("Ticket");
  if (t.status === "CLOSED") throw new AppError("CONFLICT", "This ticket is closed. Open a new ticket and reference this one.");
  await db.$transaction([
    db.supportMessage.create({ data: { ticketId: id, authorId: ctx.userId!, body } }),
    db.supportTicket.update({ where: { id }, data: { lastReplyAt: new Date(), status: t.status === "WAITING_FOR_CUSTOMER" || t.status === "RESOLVED" ? "OPEN" : t.status } }),
  ]);
  await audit({ action: "support.reply", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "ticket", targetId: id });
}

export async function closeTicket(ctx: TenantContext, id: string) {
  requirePermission(ctx, "support:write");
  const r = await db.supportTicket.updateMany({ where: { id, organizationId: ctx.organizationId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
  if (!r.count) throw notFound("Ticket");
  await audit({ action: "support.close", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "ticket", targetId: id });
}
