import { db, type Tx } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dhakaParts, startOfDhakaDay, startOfDhakaMonth } from "@/lib/format";
import type { SmsPolicy } from "@/config/sms";

/**
 * Compliance checks applied to every send path (API, dashboard, campaigns).
 */

/** Platform content blocklist (keywords, URL domains). Throws CONTENT_BLOCKED on match. */
export async function assertContentAllowed(message: string) {
  const entries = await db.blocklistEntry.findMany({ where: { type: { in: ["KEYWORD", "URL_DOMAIN"] } }, select: { type: true, value: true } });
  const lower = message.toLowerCase();
  const hit = entries.find((e) => lower.includes(e.value.toLowerCase()));
  if (hit) {
    throw new AppError(
      "CONTENT_BLOCKED",
      hit.type === "URL_DOMAIN" ? "The message contains a link to a blocked domain." : "The message contains blocked content.",
    );
  }
}

/** Numbers blocked platform-wide (e.g. complaint-driven). */
export async function blockedNumbers(phones: string[]): Promise<Set<string>> {
  if (!phones.length) return new Set();
  const rows = await db.blocklistEntry.findMany({ where: { type: "NUMBER", value: { in: phones } }, select: { value: true } });
  return new Set(rows.map((r) => r.value));
}

/** Organization suppression list (opt-outs, manual suppressions). */
export async function suppressedNumbers(organizationId: string, phones: string[]): Promise<Set<string>> {
  if (!phones.length) return new Set();
  const out = new Set<string>();
  // Chunk to keep query parameters bounded for large campaigns.
  for (let i = 0; i < phones.length; i += 5000) {
    const rows = await db.suppressionEntry.findMany({
      where: { organizationId, phone: { in: phones.slice(i, i + 5000) } },
      select: { phone: true },
    });
    rows.forEach((r) => out.add(r.phone));
  }
  return out;
}

export function isWithinQuietHours(policy: SmsPolicy, at: Date = new Date()): boolean {
  const q = policy.promotionalQuietHours;
  if (!q) return false;
  const { hour } = dhakaParts(at);
  return q.start > q.end ? hour >= q.start || hour < q.end : hour >= q.start && hour < q.end;
}

export function assertNotQuietHours(policy: SmsPolicy, at: Date = new Date()) {
  if (isWithinQuietHours(policy, at)) {
    const q = policy.promotionalQuietHours!;
    throw new AppError(
      "QUIET_HOURS",
      `Promotional messages cannot be sent between ${q.start}:00 and ${q.end}:00 (Asia/Dhaka). Schedule the campaign for a later time.`,
    );
  }
}

/**
 * Daily/monthly sending limits per organization. Must be called inside the send transaction
 * AFTER locking the wallet row, so concurrent sends for the same organization are serialised.
 */
export async function assertWithinSendingLimits(tx: Tx, organizationId: string, additional: number) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { dailySendLimit: true, monthlySendLimit: true } });
  const [today, month] = await Promise.all([
    tx.message.count({ where: { organizationId, createdAt: { gte: startOfDhakaDay() } } }),
    tx.message.count({ where: { organizationId, createdAt: { gte: startOfDhakaMonth() } } }),
  ]);
  if (today + additional > org.dailySendLimit) {
    throw new AppError("DAILY_LIMIT_EXCEEDED", `This send would exceed your daily limit of ${org.dailySendLimit} messages (${today} sent today). Contact support to raise it.`, {
      limit: org.dailySendLimit,
      used: today,
    });
  }
  if (month + additional > org.monthlySendLimit) {
    throw new AppError("MONTHLY_LIMIT_EXCEEDED", `This send would exceed your monthly limit of ${org.monthlySendLimit} messages. Contact support to raise it.`, {
      limit: org.monthlySendLimit,
      used: month,
    });
  }
}

/** Row lock on the wallet: serialises balance and limit checks per organization. */
export async function lockWallet(tx: Tx, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM wallets WHERE "organizationId" = ${organizationId}::uuid FOR UPDATE`;
}
