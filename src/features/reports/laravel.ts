import "server-only";
import type { z } from "zod";
import type { MessageEventSource, MessageSource, MessageStatus, SmsEncoding, SmsType } from "@/generated/prisma/enums";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date, dec, pageMeta } from "@/lib/laravel/convert";
import type { DailyPoint, StatusTotals } from "./queries";
import { rangeToQuery, type DateRange } from "./range";
import type { reportFiltersSchema } from "./messages";

/**
 * Reports and the message log through the Laravel API (LARAVEL_FEATURES `reports`). Filters are
 * passed as the user entered them (campaign, sender, status, recipient, source); Laravel normalises
 * the recipient number the same way as toMessageFilters().
 */

type RawFilters = z.infer<typeof reportFiltersSchema>;

function query(range: DateRange, f: RawFilters) {
  return { ...rangeToQuery(range), campaign: f.campaign, sender: f.sender, status: f.status, recipient: f.recipient, source: f.source };
}

interface LaravelDelivery {
  totals: StatusTotals;
  daily: Array<{ day: string; delivered: number; failed: number; pending: number; spend: string }>;
  operators: Array<{ operator: string; total: number; delivered: number }>;
  failures: Array<{ reason: string; count: number }>;
}

export async function delivery(range: DateRange, f: RawFilters) {
  const d = await laravelData<LaravelDelivery>("app/reports/delivery", query(range, f));
  const { delivered, failed } = d.totals;
  return {
    // Same full-precision rate as the Prisma query (Laravel rounds to 4 dp).
    totals: { ...d.totals, deliveryRate: delivered + failed > 0 ? delivered / (delivered + failed) : null } satisfies StatusTotals,
    daily: d.daily.map((p) => ({ day: p.day, delivered: p.delivered, failed: p.failed, pending: p.pending, spend: Number(p.spend) })) satisfies DailyPoint[],
    operators: d.operators,
    failures: d.failures,
  };
}

export async function filterOptions() {
  const d = await laravelData<{ campaigns: Array<{ id: string; name: string }>; senders: string[] }>("app/reports/filters");
  return { campaigns: d.campaigns, senders: d.senders.map((senderValue) => ({ senderValue })) };
}

interface LaravelMessageRow {
  id: string;
  to: string;
  status: MessageStatus;
  senderValue: string;
  smsType: SmsType;
  source: MessageSource;
  segments: number;
  cost: string;
  createdAt: string;
  errorMessage: string | null;
  campaign?: { id: string; name: string } | null;
}

export async function listMessages(range: DateRange, f: RawFilters, page: number) {
  const res = await laravel.get<LaravelMessageRow[]>("app/reports/messages", { ...query(range, f), page });
  return {
    rows: res.data.map((m) => ({ ...m, cost: dec(m.cost), createdAt: date(m.createdAt), campaign: m.campaign ?? null })),
    total: pageMeta(res.meta).total,
  };
}

interface LaravelMessage extends LaravelMessageRow {
  operator: string | null;
  body: string;
  encoding: SmsEncoding;
  errorCode: string | null;
  clientReference: string | null;
  queuedAt: string;
  submittedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  refundedAt: string | null;
  apiKey?: { name: string; prefix: string } | null;
  events?: Array<{ id: string; status: MessageStatus; providerStatus: string | null; description: string | null; source: MessageEventSource; occurredAt: string }>;
}

export async function getMessage(id: string) {
  const m = await laravelData<LaravelMessage>(`app/messages/${encodeURIComponent(id)}`);
  return {
    ...m,
    cost: dec(m.cost),
    createdAt: date(m.createdAt),
    queuedAt: date(m.queuedAt),
    submittedAt: date(m.submittedAt),
    deliveredAt: date(m.deliveredAt),
    failedAt: date(m.failedAt),
    refundedAt: date(m.refundedAt),
    campaign: m.campaign ?? null,
    apiKey: m.apiKey ?? null,
    events: (m.events ?? []).map((e) => ({ ...e, occurredAt: date(e.occurredAt) })),
  };
}
