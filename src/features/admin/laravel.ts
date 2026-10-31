import "server-only";
import type { z } from "zod";
import type {
  AbuseReportStatus,
  ActorType,
  BlocklistType,
  CampaignStatus,
  LeadStatus,
  MemberStatus,
  MessageStatus,
  OrganizationStatus,
  PaymentStatus,
  PlatformRole,
  SenderIdStatus,
  SenderType,
  SmsType,
  TicketPriority,
  TicketStatus,
  UserStatus,
  WalletTxType,
} from "@/generated/prisma/enums";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date, dec, pageMeta } from "@/lib/laravel/convert";
import { jsonStringArray } from "@/lib/utils";
import type { StoredFile } from "@/services/storage";
import type { billingPolicySchema, blocklistSchema, packageSchema, paymentSettingsSchema, planSchema, siteContentSchema, smsPolicySchema, smsProviderSchema } from "./config";
import type { OrganizationFilters, orgControlsSchema, staffReplySchema, walletAdjustSchema } from "./service";

/**
 * Admin panel through the Laravel API (LARAVEL_FEATURES `admin`). Every endpoint enforces the
 * platform permission server-side (`platform:<permission>` middleware); hiding UI is not the
 * control. Shapes match the Prisma functions in ./service.ts, ./config.ts and ./overview.ts.
 * Lists return `pageSize` so pages paginate with Laravel's page size.
 */

const enc = encodeURIComponent;

// ─── Overview & navigation ───

export async function overview() {
  const o = await laravelData<{
    users: number;
    activeUsers: number;
    orgs: number;
    suspendedOrgs: number;
    smsToday: number;
    sms30: number;
    failed24: number;
    revenue30: string;
    collected30: string;
    pendingSenders: number;
    pendingPayments: number;
    reviewCampaigns: number;
    openTickets: number;
    newAbuse: number;
    api24: number;
    newLeads: number;
    series: Array<{ day: string; delivered: number; failed: number; pending: number; spend: string }>;
    smsProvider: string;
  }>("admin/overview");
  return {
    overview: { ...o, revenue30: dec(o.revenue30), collected30: dec(o.collected30), series: o.series.map((s) => ({ ...s, spend: Number(s.spend) })) },
    smsProvider: o.smsProvider,
  };
}

export async function badges() {
  const b = await laravelData<{ campaignsInReview: number; pendingSenderIds: number; paymentsAwaitingVerification: number; openTickets: number; newAbuseReports: number }>("admin/badges");
  return { campaigns: b.campaignsInReview, senders: b.pendingSenderIds, payments: b.paymentsAwaitingVerification, tickets: b.openTickets, abuse: b.newAbuseReports };
}

// ─── Customers ───

export async function listOrganizations(q: OrganizationFilters) {
  const res = await laravel.get<
    Array<{ id: string; name: string; status: OrganizationStatus; plan: string | null; balance: string; members: number; messages: number; daily_send_limit: number; created_at: string }>
  >("admin/customers", { q: q.q, status: q.status, sort: q.sort, page: q.page, planId: q.planId, from: q.from, to: q.to, review: q.review ? 1 : undefined });
  return {
    rows: res.data.map((o) => ({
      id: o.id,
      name: o.name,
      status: o.status,
      createdAt: date(o.created_at),
      dailySendLimit: o.daily_send_limit,
      pricingPlan: o.plan ? { name: o.plan } : null,
      wallet: { balance: dec(o.balance) } as { balance: ReturnType<typeof dec> } | null,
      _count: { members: o.members, messages: o.messages },
    })),
    total: pageMeta(res.meta).total,
  };
}

interface LaravelAudit {
  id: string;
  organizationId: string | null;
  actorType: ActorType;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor?: { id: string; name: string } | null;
  organization?: { id: string; name: string } | null;
}

const toAudit = (a: LaravelAudit) => ({ ...a, createdAt: date(a.createdAt), actor: a.actor ? { name: a.actor.name } : null, organization: a.organization ?? null });

export async function getOrganizationDetail(id: string) {
  const d = await laravelData<{
    organization: {
      id: string;
      name: string;
      status: OrganizationStatus;
      suspendedReason: string | null;
      industry: string | null;
      pricingPlanId: string | null;
      dailySendLimit: number;
      monthlySendLimit: number;
      requireCampaignReview: boolean;
      createdAt: string;
      pricingPlan?: { id: string; name: string } | null;
    };
    wallet: { balance: string; lowBalanceThreshold: string } | null;
    members: Array<{ id: string; userId: string; status: MemberStatus; user: { id: string; name: string; email: string; lastLoginAt?: string | null; status?: UserStatus } | null; role: { name?: string } | null }>;
    senderIds: Array<{ id: string; value: string; type: SenderType; status: SenderIdStatus }>;
    campaigns: Array<{ id: string; name: string; status: CampaignStatus; recipientCount: number; createdAt: string }>;
    payments: Array<{ id: string; status: PaymentStatus; total: string; createdAt: string }>;
    transactions: Array<{ id: string; type: WalletTxType; amount: string; description: string; createdAt: string }>;
    sent30: number;
    failed30: number;
    audits: LaravelAudit[];
  }>(`admin/customers/${enc(id)}`);
  const o = d.organization;
  return {
    org: {
      ...o,
      createdAt: date(o.createdAt),
      pricingPlan: o.pricingPlan ?? null,
      wallet: d.wallet ? { balance: dec(d.wallet.balance), lowBalanceThreshold: dec(d.wallet.lowBalanceThreshold) } : null,
      members: d.members.map((m) => ({
        id: m.id,
        userId: m.userId,
        status: m.status,
        user: { id: m.user?.id ?? m.userId, name: m.user?.name ?? "", email: m.user?.email ?? "", lastLoginAt: date(m.user?.lastLoginAt), status: m.user?.status ?? ("ACTIVE" as UserStatus) },
        role: { name: m.role?.name ?? "" },
      })),
      senderIds: d.senderIds,
      campaigns: d.campaigns.map((c) => ({ ...c, createdAt: date(c.createdAt) })),
      payments: d.payments.map((p) => ({ ...p, total: dec(p.total), createdAt: date(p.createdAt) })),
      walletTransactions: d.transactions.map((t) => ({ ...t, amount: dec(t.amount), createdAt: date(t.createdAt) })),
    },
    sent30: d.sent30,
    failed30: d.failed30,
    audits: d.audits.map(toAudit),
  };
}

/** Plans for the account-controls form (pricing managers only; others cannot change the plan). */
export async function activePlans() {
  const rows = await laravelData<Array<{ id: string; name: string; active: boolean }>>("admin/pricing/plans");
  return rows.filter((p) => p.active).map((p) => ({ id: p.id, name: p.name }));
}

export async function updateOrganizationControls(id: string, input: z.infer<typeof orgControlsSchema>) {
  await laravel.put(`admin/customers/${enc(id)}/controls`, input);
}

export async function setOrganizationStatus(id: string, status: "ACTIVE" | "SUSPENDED", reason: string | null) {
  await laravel.post(`admin/customers/${enc(id)}/status`, { status, reason });
}

/** Balance changes happen only in Laravel's WalletService (ledger + audit, never negative). */
export async function adjustWallet(orgId: string, input: z.infer<typeof walletAdjustSchema>) {
  const { data } = await laravel.post<{ replayed: boolean }>(`admin/customers/${enc(orgId)}/wallet-adjustments`, {
    direction: input.direction,
    amount: input.amount,
    reason: input.note,
    idempotencyKey: input.idempotencyKey,
    currentPassword: input.currentPassword,
  });
  return { replayed: Boolean(data?.replayed) };
}

export async function listWallets(page: number) {
  const res = await laravel.get<Array<{ id: string; organization: { id: string; name: string; status: OrganizationStatus } | null; balance: string; lowBalanceThreshold: string; updatedAt: string }>>(
    "admin/wallets",
    { page },
  );
  const meta = pageMeta(res.meta);
  return {
    rows: res.data.map((w) => ({
      id: w.id,
      organization: w.organization ?? { id: "", name: "(deleted)", status: "SUSPENDED" as OrganizationStatus },
      balance: dec(w.balance),
      lowBalanceThreshold: dec(w.lowBalanceThreshold),
      updatedAt: date(w.updatedAt),
    })),
    total: meta.total,
    pageSize: meta.pageSize,
    totalBalance: dec(res.meta.totalBalance as string | undefined),
    belowThreshold: Number(res.meta.belowThreshold ?? 0),
  };
}

// ─── Review queues ───

export async function listCampaigns(q: { status?: string; page: number }) {
  const res = await laravel.get<
    Array<{
      id: string;
      name: string;
      smsType: SmsType;
      senderValue: string;
      message: string;
      status: CampaignStatus;
      recipientCount: number;
      estimatedCost: string;
      reviewNote: string | null;
      scheduledAt: string | null;
      createdAt: string;
      organization: { id: string; name: string; createdAt?: string } | null;
    }>
  >("admin/campaigns", { status: q.status, page: q.page });
  return {
    rows: res.data.map((c) => ({
      ...c,
      estimatedCost: dec(c.estimatedCost),
      scheduledAt: date(c.scheduledAt),
      createdAt: date(c.createdAt),
      organization: { id: c.organization?.id ?? "", name: c.organization?.name ?? "", createdAt: date(c.organization?.createdAt ?? c.createdAt) },
    })),
    total: pageMeta(res.meta).total,
  };
}

/** Laravel launches an approved immediate campaign itself (LaunchCampaignJob); nothing to launch here. */
export async function reviewCampaign(id: string, decision: "approve" | "reject", reason: string | null) {
  await laravel.post(`admin/campaigns/${enc(id)}/review`, { decision, reason });
  return { launchNow: false };
}

export async function listSenderIds(q: { status?: string; page: number }) {
  const res = await laravel.get<
    Array<{
      id: string;
      value: string;
      type: SenderType;
      status: SenderIdStatus;
      purpose: string | null;
      sampleMessage: string | null;
      rejectionReason: string | null;
      providerRef?: string | null;
      documents?: Array<{ index: number; name: string; size: number | null; contentType: string | null }>;
      createdAt: string;
      organization: { id: string; name: string; senderIdFee?: string } | null;
    }>
  >("admin/sender-ids", { status: q.status, page: q.page });
  return {
    rows: res.data.map((s) => ({
      ...s,
      createdAt: date(s.createdAt),
      documents: (s.documents ?? []).map((d) => ({ key: `document-${d.index}`, name: d.name, size: d.size ?? 0, contentType: d.contentType ?? "application/octet-stream" })) as StoredFile[],
      organization: {
        id: s.organization?.id ?? "",
        name: s.organization?.name ?? "",
        pricingPlan: s.organization?.senderIdFee !== undefined ? { senderIdFee: dec(s.organization.senderIdFee) } : null,
      },
    })),
    total: pageMeta(res.meta).total,
  };
}

export async function reviewSenderId(id: string, decision: "APPROVED" | "REJECTED" | "SUSPENDED", reason: string | null, providerRef: string | null) {
  await laravel.post(`admin/sender-ids/${enc(id)}/review`, { decision, reason, provider_ref: providerRef });
}

export async function listPayments(q: { status?: string; page: number }) {
  const res = await laravel.get<
    Array<{
      id: string;
      provider: string;
      providerRef: string | null;
      status: PaymentStatus;
      method: string | null;
      manualReference: string | null;
      total: string;
      creditAmount: string;
      createdAt: string;
      invoice: { id: string; number: string } | null;
      organization: { id: string; name: string } | null;
    }>
  >("admin/payments", { status: q.status, page: q.page });
  return {
    rows: res.data.map((p) => ({
      ...p,
      total: dec(p.total),
      creditAmount: dec(p.creditAmount),
      createdAt: date(p.createdAt),
      invoice: p.invoice ? { number: p.invoice.number } : null,
      organization: p.organization ?? { id: "", name: "" },
    })),
    total: pageMeta(res.meta).total,
  };
}

/** Approval credits the wallet exactly once inside Laravel's PaymentService. */
export async function reviewManualPayment(id: string, decision: "approve" | "reject", reason: string | null) {
  await laravel.post(`admin/payments/${enc(id)}/review`, { decision, reason });
}

// ─── Support ───

interface LaravelStaffTicket {
  id: string;
  number: number;
  subject: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  lastReplyAt: string;
  createdAt: string;
  organization?: { id: string; name: string } | null;
  assignedTo?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string; email?: string } | null;
  messages?: Array<{ id: string; body: string; isStaff: boolean; isInternal: boolean; createdAt: string; author: { id: string; name: string } | null }>;
}

function toStaffTicket(t: LaravelStaffTicket) {
  return {
    id: t.id,
    number: t.number,
    subject: t.subject,
    category: t.category,
    priority: t.priority,
    status: t.status,
    lastReplyAt: date(t.lastReplyAt),
    createdAt: date(t.createdAt),
    organization: { id: t.organization?.id ?? "", name: t.organization?.name ?? "" },
    assignedTo: t.assignedTo ? { name: t.assignedTo.name } : null,
    createdBy: { name: t.createdBy?.name ?? "" },
  };
}

export async function listTickets(q: { status?: TicketStatus; mine?: boolean; page: number }) {
  const res = await laravel.get<LaravelStaffTicket[]>("admin/support/tickets", { status: q.status, mine: q.mine ? 1 : undefined, page: q.page });
  return { rows: res.data.map(toStaffTicket), total: pageMeta(res.meta).total };
}

/** Staff view: includes internal notes (never sent to customers). */
export async function getTicket(id: string) {
  const t = await laravelData<LaravelStaffTicket>(`admin/support/tickets/${enc(id)}`);
  return {
    ...toStaffTicket(t),
    assignedTo: t.assignedTo ? { id: t.assignedTo.id, name: t.assignedTo.name } : null,
    createdBy: { name: t.createdBy?.name ?? "", email: t.createdBy?.email ?? "" },
    messages: (t.messages ?? []).map((m) => ({ ...m, createdAt: date(m.createdAt), author: { name: m.author?.name ?? "" } })),
  };
}

export async function staffReply(id: string, input: z.infer<typeof staffReplySchema>) {
  await laravel.post(`admin/support/tickets/${enc(id)}/messages`, { body: input.body, internal: input.internal, status: input.status ?? null });
}

export async function setTicketStatus(id: string, status: TicketStatus, assignToMe: boolean) {
  await laravel.put(`admin/support/tickets/${enc(id)}/status`, { status, assignToMe });
}

// ─── Users ───

export async function listUsers(q: { q?: string; role?: string; page: number }) {
  const res = await laravel.get<
    Array<{
      id: string;
      name: string;
      email: string;
      platformRole: PlatformRole;
      status: UserStatus;
      emailVerifiedAt: string | null;
      lastLoginAt: string | null;
      createdAt: string;
      organizations?: Array<{ id: string; name: string }>;
    }>
  >("admin/users", { q: q.q, role: q.role, page: q.page });
  return {
    rows: res.data.map((u) => ({
      ...u,
      emailVerifiedAt: date(u.emailVerifiedAt),
      lastLoginAt: date(u.lastLoginAt),
      createdAt: date(u.createdAt),
      memberships: (u.organizations ?? []).map((o) => ({ organization: { id: o.id, name: o.name } })),
    })),
    total: pageMeta(res.meta).total,
  };
}

/** Role/status change (reason + password re-confirmation); Laravel revokes the user's sessions and keeps one active super admin. */
export async function updateUserAccess(userId: string, input: { platformRole?: PlatformRole; status?: "ACTIVE" | "SUSPENDED"; reason: string; currentPassword: string }) {
  await laravel.put(`admin/users/${enc(userId)}/access`, input);
}

// ─── Abuse, leads, blocklist ───

/** Up to `limit` rows from a paginated admin list (the abuse page shows the latest 50 of each). */
async function firstRows<T>(path: string, query: Record<string, string | number | undefined>, limit: number): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < limit && page <= 40; page++) {
    const res = await laravel.get<T[]>(path, { ...query, page });
    out.push(...res.data);
    if (page >= pageMeta(res.meta).totalPages) break;
  }
  return out.slice(0, limit);
}

export async function abusePageData() {
  const [reports, leads, blocklist] = await Promise.all([
    firstRows<{
      id: string;
      reporterName: string | null;
      reporterEmail: string | null;
      reporterPhone: string | null;
      senderValue: string;
      messageContent: string;
      receivedAt: string | null;
      description: string | null;
      status: AbuseReportStatus;
      organizationId: string | null;
      organizationName: string | null;
      resolutionNote: string | null;
      createdAt: string;
    }>("admin/abuse-reports", {}, 50),
    firstRows<{ id: string; name: string; company: string | null; email: string; phone: string | null; subject: string; message: string; status: LeadStatus; createdAt: string }>("admin/leads", {}, 50),
    firstRows<{ id: string; type: BlocklistType; value: string; reason: string | null; createdAt: string }>("admin/blocklist", {}, 2000),
  ]);
  return {
    reports: reports.map((r) => ({ ...r, receivedAt: date(r.receivedAt), createdAt: date(r.createdAt) })),
    leads: leads.map((l) => ({ ...l, createdAt: date(l.createdAt) })),
    blocklist: blocklist.map((b) => ({ ...b, createdAt: date(b.createdAt) })),
    orgNames: new Map(reports.filter((r) => r.organizationId && r.organizationName).map((r) => [r.organizationId!, r.organizationName!])),
  };
}

export async function setAbuseStatus(id: string, status: AbuseReportStatus, note: string | null) {
  await laravel.put(`admin/abuse-reports/${enc(id)}`, { status, note });
}

export async function setLeadStatus(id: string, status: LeadStatus) {
  await laravel.put(`admin/leads/${enc(id)}`, { status });
}

export async function addBlocklist(input: z.infer<typeof blocklistSchema>) {
  await laravel.post("admin/blocklist", input);
}

export async function removeBlocklist(id: string) {
  await laravel.delete(`admin/blocklist/${enc(id)}`);
}

// ─── Logs ───

export async function listMessages(q: { to?: string; status?: MessageStatus; provider?: string; page: number }) {
  const res = await laravel.get<
    Array<{ id: string; to: string; status: MessageStatus; senderValue: string; cost: string; errorMessage: string | null; providerMessageId?: string | null; createdAt: string; organization: { id: string; name: string } | null }>
  >("admin/messages", { to: q.to, status: q.status, provider: q.provider, page: q.page });
  const meta = pageMeta(res.meta);
  return {
    rows: res.data.map((m) => ({ ...m, cost: dec(m.cost), createdAt: date(m.createdAt), providerMessageId: m.providerMessageId ?? null, organization: m.organization ?? { id: "", name: "" } })),
    total: meta.total,
    pageSize: meta.pageSize,
  };
}

export async function listAuditLogs(q: { action?: string; organizationId?: string; page: number }) {
  const res = await laravel.get<LaravelAudit[]>("admin/audit-logs", { action: q.action, organizationId: q.organizationId, page: q.page });
  const meta = pageMeta(res.meta, 50);
  return { rows: res.data.map(toAudit), total: meta.total, pageSize: meta.pageSize };
}

export async function listApiLogs(q: { status?: "4xx" | "5xx"; page: number }) {
  const res = await laravel.get<
    Array<{
      id: string;
      method: string;
      path: string;
      statusCode: number;
      durationMs: number;
      errorCode: string | null;
      ipAddress: string | null;
      createdAt: string;
      apiKey?: { name: string; prefix: string } | null;
      organization?: { id: string; name: string } | null;
    }>
  >("admin/api-logs", { status: q.status, page: q.page });
  const meta = pageMeta(res.meta, 50);
  return {
    rows: res.data.map((r) => ({ ...r, createdAt: date(r.createdAt), apiKey: r.apiKey ? { prefix: r.apiKey.prefix } : null, organization: r.organization ?? null })),
    total: meta.total,
    pageSize: meta.pageSize,
  };
}

// ─── Pricing & settings ───

interface LaravelPlan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  minRechargeAmount: string;
  transactionalNonMasking: string;
  transactionalMasking: string;
  promotionalNonMasking: string;
  promotionalMasking: string;
  senderIdFee: string;
  features: unknown;
  isCustom: boolean;
  isPublic: boolean;
  isDefault: boolean;
  active: boolean;
  highlighted: boolean;
  sortOrder: number;
}

export async function pricingPageData() {
  const [plans, packages, policy] = await Promise.all([
    laravelData<LaravelPlan[]>("admin/pricing/plans"),
    laravelData<Array<{ id: string; name: string; amount: string; bonusPercent: string; description: string | null; active: boolean; sortOrder: number }>>("admin/pricing/packages"),
    laravelData<{ vatRatePercent: number; minimumTopUp: number; maximumTopUp: number; balanceValidityMonths: number | null; invoicePrefix: string; pricesExcludeVat: boolean }>("admin/settings/billing-policy"),
  ]);
  return {
    plans: plans.map((p) => ({
      ...p,
      minRechargeAmount: dec(p.minRechargeAmount),
      transactionalNonMasking: dec(p.transactionalNonMasking),
      transactionalMasking: dec(p.transactionalMasking),
      promotionalNonMasking: dec(p.promotionalNonMasking),
      promotionalMasking: dec(p.promotionalMasking),
      senderIdFee: dec(p.senderIdFee),
      features: jsonStringArray(p.features),
    })),
    packages: packages.map((p) => ({ ...p, amount: dec(p.amount), bonusPercent: dec(p.bonusPercent) })),
    policy,
  };
}

export async function savePlan(input: z.infer<typeof planSchema>, id?: string) {
  const body = { ...input, features: input.features.join("\n") };
  if (id) await laravel.put(`admin/pricing/plans/${enc(id)}`, body);
  else await laravel.post("admin/pricing/plans", body);
}

export async function savePackage(input: z.infer<typeof packageSchema>, id?: string) {
  if (id) await laravel.put(`admin/pricing/packages/${enc(id)}`, input);
  else await laravel.post("admin/pricing/packages", input);
}

export async function saveBillingPolicy(input: z.infer<typeof billingPolicySchema>) {
  await laravel.put("admin/settings/billing-policy", input);
}

export async function saveSmsPolicy(input: z.infer<typeof smsPolicySchema>) {
  await laravel.put("admin/settings/sms-policy", { ...input, optOutKeywords: input.optOutKeywords.join(", ") });
}

/** Provider credentials go server-to-server to Laravel (stored encrypted there, never returned). */
export async function saveSmsProvider(input: z.infer<typeof smsProviderSchema>) {
  await laravel.put("admin/settings/sms-provider", input);
}

export async function savePaymentSettings(input: z.infer<typeof paymentSettingsSchema>) {
  await laravel.put("admin/settings/payments", input);
}

export async function saveSiteContent(input: z.infer<typeof siteContentSchema>) {
  await laravel.put("admin/settings/site-content", input);
}

export interface LaravelSettingsOverview {
  smsPolicy: {
    segmentation: { gsm7: { single: number; multipart: number }; ucs2: { single: number; multipart: number }; maxSegments: number };
    refundFailedMessages: boolean;
    promotionalQuietHours: { start: number; end: number } | null;
    promotionalOptOutText: string;
    appendOptOutText: boolean;
    reviewThresholdRecipients: number;
    optOutKeywords: string[];
  };
  smsProvider: { provider: "mock" | "http"; url: string; mapping?: Record<string, string> };
  payments: { enabled: string[]; manualInstructions: string; sslcommerz: { storeId: string; live: boolean } };
  siteContent: { contact: Record<string, string>; announcement: { enabled: boolean; text: string; href?: string } };
  secrets: Record<string, boolean>;
}

export async function settingsPageData() {
  return laravelData<LaravelSettingsOverview>("admin/settings");
}
