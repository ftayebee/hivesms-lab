import "server-only";
import type { CampaignStatus, MessageStatus, SenderType, SmsEncoding, SmsType } from "@/generated/prisma/enums";
import { sha256 } from "@/lib/crypto";
import { laravel, laravelData, isLaravelApiError } from "@/lib/laravel-api";
import { date, dec, pageMeta } from "@/lib/laravel/convert";
import type { SegmentationRules } from "@/lib/sms-segments";
import type { ComposerInput } from "./schemas";
import type { CampaignEstimate } from "./service";

/**
 * Campaigns and the SMS composer through the Laravel API (LARAVEL_FEATURES `campaigns`).
 * Laravel validates, prices, checks the balance, decides on review, charges once and launches
 * (LaunchCampaignJob) — the Next.js side never launches or dispatches a Laravel-created campaign.
 * Messages go out through the SMS provider configured in Laravel (mock on local/staging).
 */

interface LaravelCampaign {
  id: string;
  name: string;
  smsType: SmsType;
  senderIdId: string | null;
  senderValue: string;
  senderType: SenderType;
  templateId: string | null;
  message: string;
  encoding: SmsEncoding;
  segmentsPerMessage: number;
  status: CampaignStatus;
  audience?: { groupIds: string[]; numbers: string[] };
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  recipientCount: number;
  skippedCount: number;
  queuedCount: number;
  submittedCount: number;
  deliveredCount: number;
  failedCount: number;
  estimatedCost: string | null;
  actualCost: string | null;
  refundedAmount: string | null;
  failureReason: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  template?: { id: string; name: string } | null;
}

function toCampaign(c: LaravelCampaign) {
  return {
    ...c,
    audience: c.audience ?? { groupIds: [], numbers: [] },
    scheduledAt: date(c.scheduledAt),
    startedAt: date(c.startedAt),
    completedAt: date(c.completedAt),
    pausedAt: date(c.pausedAt),
    cancelledAt: date(c.cancelledAt),
    reviewedAt: date(c.reviewedAt),
    createdAt: date(c.createdAt),
    updatedAt: date(c.updatedAt),
    estimatedCost: dec(c.estimatedCost),
    actualCost: dec(c.actualCost),
    refundedAmount: dec(c.refundedAmount),
    template: c.template ? { name: c.template.name } : null,
  };
}

/** The composer form exactly as the user filled it; Laravel parses numbers, schedule and audience. */
function composerBody(input: ComposerInput) {
  return {
    ...(input.id ? { id: input.id } : {}),
    name: input.name,
    smsType: input.smsType,
    senderId: input.senderId,
    templateId: input.templateId ?? null,
    message: input.message,
    groupIds: input.groupIds,
    numbers: input.numbers,
    scheduleMode: input.scheduleMode,
    scheduledAt: input.scheduledAt,
  };
}

export async function saveDraft(input: ComposerInput) {
  const body = composerBody(input);
  const res = input.id ? await laravel.put<LaravelCampaign>(`app/campaigns/${encodeURIComponent(input.id)}`, body) : await laravel.post<LaravelCampaign>("app/campaigns", body);
  return toCampaign(res.data);
}

export async function estimate(input: ComposerInput): Promise<CampaignEstimate> {
  return (await laravel.post<CampaignEstimate>("app/campaigns/estimate", composerBody(input))).data;
}

/**
 * Submits (send now / schedule / review). The Idempotency-Key is derived from the member, the
 * organization and the exact form content within a one-minute window, so a double click or a
 * retried request creates one campaign; Laravel replays the first answer.
 */
export async function submit(input: ComposerInput, actor: { userId: string | null; organizationId: string }) {
  const body = composerBody(input);
  const key = `composer-${sha256(`${actor.organizationId}:${actor.userId}:${Math.floor(Date.now() / 60_000)}:${JSON.stringify(body)}`)}`;
  const res = await laravel.post<LaravelCampaign>("app/campaigns/submit", body, { idempotencyKey: key });
  // Laravel already queued the launch (LaunchCampaignJob); nothing to launch here.
  return { campaign: toCampaign(res.data), launchNow: false as const };
}

export async function op(id: string, action: "pause" | "resume" | "cancel") {
  await laravel.post(`app/campaigns/${encodeURIComponent(id)}/${action}`);
}

export async function duplicate(id: string) {
  return toCampaign((await laravel.post<LaravelCampaign>(`app/campaigns/${encodeURIComponent(id)}/duplicate`)).data);
}

export async function remove(id: string) {
  await laravel.delete(`app/campaigns/${encodeURIComponent(id)}`);
}

export async function listCampaigns(q: { q?: string; status?: CampaignStatus; type?: "TRANSACTIONAL" | "PROMOTIONAL"; page: number }) {
  const res = await laravel.get<LaravelCampaign[]>("app/campaigns", { q: q.q, status: q.status, type: q.type, page: q.page });
  return {
    rows: res.data.map(toCampaign),
    total: pageMeta(res.meta, 20).total,
    statusCounts: (res.meta.statusCounts ?? {}) as Partial<Record<CampaignStatus, number>>,
  };
}

interface LaravelCampaignDetail {
  campaign: LaravelCampaign;
  createdBy: string | null;
  stats: { queued: number; sent: number; delivered: number; failed: number; total: number };
  skipped: Record<string, number>;
  failures: Array<{ reason: string; count: number }>;
  operators: Array<{ operator: string; total: number; delivered: number }>;
  timeline: Array<{ id: string; action: string; at: string; actor: string | null; metadata: Record<string, unknown> | null }>;
}

export async function getCampaignDetail(id: string) {
  const d = await laravelData<LaravelCampaignDetail>(`app/campaigns/${encodeURIComponent(id)}`);
  return {
    campaign: toCampaign(d.campaign),
    createdBy: d.createdBy,
    stats: d.stats,
    skipped: d.skipped,
    failures: d.failures,
    operators: d.operators,
    timeline: d.timeline.map((t) => ({ id: t.id, action: t.action, at: date(t.at), actor: t.actor, metadata: (t.metadata ?? {}) as Record<string, unknown> })),
  };
}

interface LaravelCampaignMessage {
  id: string;
  to: string;
  status: MessageStatus;
  segments: number;
  cost: string;
  errorMessage: string | null;
  submittedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  operator: string | null;
  refundedAt: string | null;
}

export async function listCampaignMessages(id: string, opts: { status?: MessageStatus; page: number; pageSize: number }) {
  const pageSize = Math.min(100, Math.max(10, opts.pageSize));
  const res = await laravel.get<LaravelCampaignMessage[]>(`app/campaigns/${encodeURIComponent(id)}/messages`, { status: opts.status, page: opts.page, pageSize });
  return {
    rows: res.data.map((m) => ({ ...m, cost: dec(m.cost), submittedAt: date(m.submittedAt), deliveredAt: date(m.deliveredAt), failedAt: date(m.failedAt), refundedAt: date(m.refundedAt) })),
    total: pageMeta(res.meta, pageSize).total,
  };
}

/** Composer settings (GET /app/sms/composer). */
export interface ComposerConfig {
  segmentation: SegmentationRules;
  promotionalQuietHours: { start: number; end: number } | null;
  promotionalOptOutText: string;
  rates: { transactionalMasking: string; transactionalNonMasking: string; promotionalMasking: string; promotionalNonMasking: string };
  balance: string;
}

export async function composerConfig() {
  const c = await laravelData<ComposerConfig>("app/sms/composer");
  return { ...c, balance: dec(c.balance) };
}

/** A draft to pre-fill the composer, or null (not a draft / not this organization's). */
export async function draftForComposer(id: string) {
  try {
    const d = await laravelData<LaravelCampaignDetail>(`app/campaigns/${encodeURIComponent(id)}`);
    return d.campaign.status === "DRAFT" ? toCampaign(d.campaign) : null;
  } catch (err) {
    if (isLaravelApiError(err) && err.kind === "not_found") return null;
    throw err;
  }
}
