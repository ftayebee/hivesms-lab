import "server-only";
import type { z } from "zod";
import type { TicketPriority, TicketStatus } from "@/generated/prisma/enums";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date, pageMeta } from "@/lib/laravel/convert";
import type { ticketSchema } from "./service";

/**
 * Customer support tickets through the Laravel API (LARAVEL_FEATURES `support`). Laravel never
 * returns internal staff notes to customers (SupportService::find filters isInternal = false).
 */

interface LaravelTicket {
  id: string;
  number: number;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  lastReplyAt: string;
  closedAt: string | null;
  createdAt: string;
  messageCount?: number;
  createdBy?: { id: string; name: string } | null;
  messages?: Array<{ id: string; body: string; isStaff: boolean; isInternal: boolean; createdAt: string; author: { id: string; name: string } | null }>;
}

function toTicketRow(t: LaravelTicket) {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    lastReplyAt: date(t.lastReplyAt),
    closedAt: date(t.closedAt),
    createdAt: date(t.createdAt),
    createdBy: { name: t.createdBy?.name ?? "" },
    _count: { messages: t.messageCount ?? 0 },
  };
}

function toTicket(t: LaravelTicket) {
  return {
    ...toTicketRow(t),
    messages: (t.messages ?? []).map((m) => ({ ...m, createdAt: date(m.createdAt), author: { name: m.author?.name ?? "" } })),
  };
}

export async function listTickets(opts: { status?: TicketStatus; page: number }) {
  const res = await laravel.get<LaravelTicket[]>("app/support/tickets", { status: opts.status, page: opts.page });
  return { rows: res.data.map(toTicketRow), total: pageMeta(res.meta, 20).total };
}

export async function createTicket(input: z.infer<typeof ticketSchema>) {
  return toTicket((await laravel.post<LaravelTicket>("app/support/tickets", input)).data);
}

export async function getTicket(id: string) {
  return toTicket(await laravelData<LaravelTicket>(`app/support/tickets/${encodeURIComponent(id)}`));
}

export async function replyToTicket(id: string, body: string) {
  await laravel.post(`app/support/tickets/${encodeURIComponent(id)}/messages`, { body });
}

export async function closeTicket(id: string) {
  await laravel.post(`app/support/tickets/${encodeURIComponent(id)}/close`);
}
