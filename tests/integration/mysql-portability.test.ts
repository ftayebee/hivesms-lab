import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { sendMessages } from "@/services/messaging/send";
import { claimQueuedMessages } from "@/services/messaging/dispatcher";
import { applyStatusUpdate } from "@/services/messaging/delivery";
import { creditWallet, debitWallet } from "@/services/billing/wallet";
import { completePayment } from "@/services/billing/payments";
import { allTags, bulkContacts, listContacts } from "@/features/contacts/service";
import { getDailySeries, getStatusTotals } from "@/features/reports/queries";
import { parseRange } from "@/features/reports/range";
import { createTenant, resetDatabase } from "../support/factories";

/**
 * Behaviour that was re-implemented when moving from PostgreSQL to MySQL/MariaDB
 * (see docs/06-mysql-migration-audit.md). Each test targets one rewritten query.
 */
const base = { message: "Your code is 123456", smsType: "TRANSACTIONAL" as const, source: "API" as const };

describe("MySQL/MariaDB portability", () => {
  beforeEach(resetDatabase);

  it("never hands the same queued message to two concurrent claimers", async () => {
    const { ctx } = await createTenant({ balance: 100 });
    const recipients = Array.from({ length: 40 }, (_, i) => ({ phone: `0171${String(2000000 + i)}` }));
    await sendMessages(ctx, { ...base, recipients, mode: "bulk" });
    const batches = await Promise.all(Array.from({ length: 6 }, () => claimQueuedMessages(10)));
    // Whatever contention left over is picked up by the next claim; nothing is claimed twice.
    const all = [...batches.flat(), ...(await claimQueuedMessages(40))];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(40);
    const leased = await db.message.findMany({ select: { attempts: true, lockedUntil: true } });
    expect(leased.every((m) => m.attempts === 1 && m.lockedUntil && m.lockedUntil > new Date())).toBe(true);
    // Leased messages are not claimable again until the lease expires.
    expect(await claimQueuedMessages(10)).toEqual([]);
  });

  it("runs claims and delivery status updates concurrently without deadlock errors", async () => {
    const { ctx } = await createTenant({ balance: 100 });
    const recipients = Array.from({ length: 120 }, (_, i) => ({ phone: `0171${String(3000000 + i)}` }));
    const sent = await sendMessages(ctx, { ...base, recipients, mode: "bulk" });
    const first = sent.accepted.slice(0, 60).map((m) => m.id);
    await claimQueuedMessages(60, first);
    // Workers claim the rest while delivery reports for the first half arrive.
    const work = [
      ...Array.from({ length: 6 }, () => claimQueuedMessages(10)),
      ...first.map((id) => applyStatusUpdate({ messageId: id, status: "DELIVERED", source: "PROVIDER_WEBHOOK", dedupeKey: `t:${id}` })),
    ];
    const results = await Promise.allSettled(work);
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
    expect(await db.message.count({ where: { status: "DELIVERED" } })).toBe(60);
    const claimed = [...results.slice(0, 6).flatMap((r) => (r.status === "fulfilled" ? (r.value as string[]) : [])), ...(await claimQueuedMessages(60))];
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBe(60);
    expect(claimed.some((id) => first.includes(id))).toBe(false);
  });

  it("claims only the requested ids", async () => {
    const { ctx } = await createTenant({ balance: 10 });
    const r = await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345678" }, { phone: "01812345678" }], mode: "bulk" });
    const ids = await claimQueuedMessages(10, [r.accepted[0].id]);
    expect(ids).toEqual([r.accepted[0].id]);
    expect(await claimQueuedMessages(10, [])).toEqual([]);
  });

  it("counts rate-limit hits exactly under concurrency", async () => {
    const rule = { limit: 5, windowSec: 60 };
    const results = await Promise.all(Array.from({ length: 12 }, () => rateLimit("test:concurrent", rule)));
    expect(results.filter((r) => r.allowed)).toHaveLength(5);
    expect(results.map((r) => r.remaining).sort((a, b) => a - b)[0]).toBe(0);
  });

  it("keeps exact decimal balances and clears the low-balance flag only above the threshold", async () => {
    const { org } = await createTenant({ balance: 0 });
    await db.wallet.update({ where: { organizationId: org.id }, data: { lowBalanceThreshold: "100", lowBalanceNotifiedAt: new Date() } });
    // 50 + 60 = 110 > 100. With left-to-right SET evaluation done wrong, the flag check would see 170.
    await db.$transaction((tx) => creditWallet(tx, { organizationId: org.id, amount: "50", reason: "ADJUSTMENT", description: "t" }));
    let w = await db.wallet.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(w.lowBalanceNotifiedAt).not.toBeNull(); // 50 is still below 100
    const tx = await db.$transaction((t) => creditWallet(t, { organizationId: org.id, amount: "60.1234", reason: "ADJUSTMENT", description: "t2" }));
    w = await db.wallet.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(w.lowBalanceNotifiedAt).toBeNull();
    expect(w.balance.toString()).toBe("110.1234");
    expect(tx.balanceAfter.toString()).toBe("110.1234");
    await db.$transaction((t) => debitWallet(t, { organizationId: org.id, amount: "0.1234", reason: "ADJUSTMENT", description: "t3" }));
    w = await db.wallet.findUniqueOrThrow({ where: { organizationId: org.id } });
    expect(w.balance.toString()).toBe("110");
  });

  it("numbers invoices sequentially without duplicates under concurrency", async () => {
    const { org } = await createTenant({ balance: 0 });
    const payments = await Promise.all(
      Array.from({ length: 4 }, () =>
        db.payment.create({ data: { organizationId: org.id, provider: "manual", amount: "100", total: "100", creditAmount: "100", status: "AWAITING_VERIFICATION" } }),
      ),
    );
    await Promise.all(payments.map((p) => completePayment(p.id, { actor: { type: "SYSTEM" } })));
    const numbers = (await db.invoice.findMany({ select: { number: true } })).map((i) => Number(i.number.split("-").pop()));
    expect(new Set(numbers).size).toBe(4);
    numbers.sort((a, b) => a - b);
    expect(numbers[3] - numbers[0]).toBe(3);
  });

  it("stores tags as JSON arrays: filter, bulk add (no duplicates) and distinct list", async () => {
    const { ctx, org } = await createTenant();
    const a = await db.contact.create({ data: { organizationId: org.id, phone: "+8801712345678", tags: ["vip"] } });
    const b = await db.contact.create({ data: { organizationId: org.id, phone: "+8801812345678", tags: [] } });
    await bulkContacts(ctx, [a.id, b.id], { type: "addTag", tag: "dhaka" });
    await bulkContacts(ctx, [a.id], { type: "addTag", tag: "dhaka" });
    expect((await db.contact.findUniqueOrThrow({ where: { id: a.id } })).tags).toEqual(["vip", "dhaka"]);
    expect((await db.contact.findUniqueOrThrow({ where: { id: b.id } })).tags).toEqual(["dhaka"]);
    expect(await allTags(ctx)).toEqual(["dhaka", "vip"]);
    const vip = await listContacts(ctx, { tag: "vip", page: 1 } as Parameters<typeof listContacts>[1]);
    expect(vip.rows.map((r) => r.id)).toEqual([a.id]);
  });

  it("matches provider message ids case-sensitively", async () => {
    const { ctx } = await createTenant({ balance: 10 });
    const r = await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345678" }, { phone: "01812345678" }], mode: "bulk" });
    await db.message.update({ where: { id: r.accepted[0].id }, data: { provider: "http", providerMessageId: "AbC123" } });
    // Would violate the unique index under a case-insensitive collation.
    await db.message.update({ where: { id: r.accepted[1].id }, data: { provider: "http", providerMessageId: "abc123" } });
    const found = await db.message.findUnique({ where: { provider_providerMessageId: { provider: "http", providerMessageId: "abc123" } } });
    expect(found?.id).toBe(r.accepted[1].id);
  });

  it("buckets report days in Asia/Dhaka (UTC+6)", async () => {
    const { ctx } = await createTenant({ balance: 10 });
    const r = await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345678" }], mode: "single" });
    // 2026-09-29 20:30 UTC is 2026-09-30 02:30 in Dhaka.
    await db.message.update({ where: { id: r.accepted[0].id }, data: { createdAt: new Date("2026-09-29T20:30:00Z"), status: "DELIVERED" } });
    const range = parseRange({ range: "custom", from: "2026-09-29", to: "2026-09-30" });
    const series = await getDailySeries(ctx, range);
    expect(series.find((d) => d.day === "2026-09-30")?.delivered).toBe(1);
    expect(series.find((d) => d.day === "2026-09-29")?.delivered ?? 0).toBe(0);
    const totals = await getStatusTotals(ctx, range, { status: "DELIVERED", to: "+8801712345678" });
    expect(totals).toMatchObject({ total: 1, delivered: 1 });
  });
});
