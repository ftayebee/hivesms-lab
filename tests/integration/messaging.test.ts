import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { sendMessages } from "@/services/messaging/send";
import { applyStatusUpdate } from "@/services/messaging/delivery";
import { claimQueuedMessages, dispatchMessages, pollDeliveryStatuses } from "@/services/messaging/dispatcher";
import { MockSmsProvider } from "@/services/sms/mock-provider";
import { balanceOf, createTenant, resetDatabase } from "../support/factories";

const base = { message: "Your code is 123456", smsType: "TRANSACTIONAL" as const, source: "API" as const };

describe("sending", () => {
  beforeEach(resetDatabase);

  it("queues, charges segments x rate atomically and writes a ledger entry", async () => {
    const { ctx, org } = await createTenant({ balance: 10 });
    const r = await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345678" }, { phone: "01812345678" }], mode: "bulk" });
    expect(r.accepted).toHaveLength(2);
    // Starter plan transactional non-masking example rate: 0.40 per segment.
    expect(r.totalCost).toBe("0.80");
    expect(await balanceOf(org.id)).toBeCloseTo(9.2);
    const tx = await db.walletTransaction.findFirstOrThrow({ where: { organizationId: org.id, reason: "SMS_CHARGE" } });
    expect(Number(tx.balanceAfter)).toBeCloseTo(9.2);
    expect(await db.message.count({ where: { organizationId: org.id, status: "QUEUED" } })).toBe(2);
  });

  it("charges Bangla messages by Unicode segments", async () => {
    const { ctx } = await createTenant({ balance: 10 });
    const r = await sendMessages(ctx, { ...base, message: "ক".repeat(71), recipients: [{ phone: "01712345678" }], mode: "single" });
    expect(r.accepted[0]).toMatchObject({ encoding: "UCS2", segments: 2, cost: "0.80" });
  });

  it("fails without charging when the balance is insufficient", async () => {
    const { ctx, org } = await createTenant({ balance: 0.1 });
    await expect(sendMessages(ctx, { ...base, recipients: [{ phone: "01712345678" }], mode: "single" })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(await balanceOf(org.id)).toBeCloseTo(0.1);
    expect(await db.message.count()).toBe(0);
  });

  it("never overdraws the wallet under concurrent sends", async () => {
    const { ctx, org } = await createTenant({ balance: 2 }); // 5 messages at 0.40
    const attempts = Array.from({ length: 10 }, (_, i) => sendMessages(ctx, { ...base, recipients: [{ phone: `0171234${String(1000 + i)}` }], mode: "single" }).then(() => "ok", (e) => e.code));
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok")).toHaveLength(5);
    expect(results.filter((r) => r === "INSUFFICIENT_BALANCE")).toHaveLength(5);
    expect(await balanceOf(org.id)).toBeCloseTo(0);
  });

  it("enforces the daily sending limit", async () => {
    const { ctx } = await createTenant({ balance: 100, dailySendLimit: 2 });
    await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345678" }, { phone: "01712345679" }], mode: "bulk" });
    await expect(sendMessages(ctx, { ...base, recipients: [{ phone: "01712345670" }], mode: "single" })).rejects.toMatchObject({ code: "DAILY_LIMIT_EXCEEDED" });
  });

  it("skips suppressed numbers for promotional messages only", async () => {
    const { ctx, org } = await createTenant({ balance: 100 });
    await db.suppressionEntry.create({ data: { organizationId: org.id, phone: "+8801712345678", reason: "OPT_OUT" } });
    const recipients = [{ phone: "01712345678" }, { phone: "01812345678" }];
    // Promotional sends outside quiet hours only; disable quiet hours for a deterministic test.
    await db.setting.create({ data: { key: "sms.policy", value: { promotionalQuietHours: null } } });
    const { clearSettingsCache } = await import("@/services/settings");
    clearSettingsCache();
    const promo = await sendMessages(ctx, { ...base, smsType: "PROMOTIONAL", recipients, mode: "bulk" });
    expect(promo.accepted.map((a) => a.to)).toEqual(["+8801812345678"]);
    expect(promo.rejected[0]).toMatchObject({ code: "RECIPIENT_SUPPRESSED" });
    const tx = await sendMessages(ctx, { ...base, recipients, mode: "bulk" });
    expect(tx.accepted).toHaveLength(2);
  });

  it("blocks content on the platform blocklist and unapproved sender IDs", async () => {
    const { ctx, org } = await createTenant({ balance: 100 });
    await db.blocklistEntry.create({ data: { type: "URL_DOMAIN", value: "evil.example" } });
    await expect(sendMessages(ctx, { ...base, message: "Claim at evil.example/x", recipients: [{ phone: "01712345678" }], mode: "single" })).rejects.toMatchObject({ code: "CONTENT_BLOCKED" });
    await db.senderId.create({ data: { organizationId: org.id, value: "PENDINGID", type: "MASKING", status: "PENDING" } });
    await expect(sendMessages(ctx, { ...base, senderId: "PENDINGID", recipients: [{ phone: "01712345678" }], mode: "single" })).rejects.toMatchObject({ code: "SENDER_ID_NOT_APPROVED" });
  });
});

describe("dispatch and delivery reports", () => {
  beforeEach(resetDatabase);

  it("submits via the provider, then delivers or fails with refunds", async () => {
    const { ctx, org } = await createTenant({ balance: 10 });
    await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345671" }, { phone: "01712340000" }, { phone: "01712349999" }], mode: "bulk" });
    const ids = await claimQueuedMessages(10);
    expect(ids).toHaveLength(3);
    // A second worker must not claim the same messages.
    expect(await claimQueuedMessages(10)).toHaveLength(0);
    const r = await dispatchMessages(ids, new MockSmsProvider());
    expect(r).toMatchObject({ submitted: 2, failed: 1 });
    // Rejected at submission: refunded immediately.
    const rejected = await db.message.findFirstOrThrow({ where: { to: "+8801712340000" } });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.refundedAt).not.toBeNull();
    // Simulate delivery reports arriving later.
    await db.message.updateMany({ where: { status: "SUBMITTED" }, data: { updatedAt: new Date(Date.now() - 60_000) } });
    await new Promise((res) => setTimeout(res, 3100));
    await pollDeliveryStatuses();
    expect((await db.message.findFirstOrThrow({ where: { to: "+8801712345671" } })).status).toBe("DELIVERED");
    expect((await db.message.findFirstOrThrow({ where: { to: "+8801712349999" } })).status).toBe("FAILED");
    // 3 x 0.40 charged, 2 refunded.
    expect(await balanceOf(org.id)).toBeCloseTo(9.6);
    expect(await db.walletTransaction.count({ where: { organizationId: org.id, reason: "REFUND" } })).toBe(2);
  });

  it("retries temporary provider errors with backoff", async () => {
    const { ctx } = await createTenant({ balance: 10 });
    await sendMessages(ctx, { ...base, recipients: [{ phone: "01712348888" }], mode: "single" });
    const ids = await claimQueuedMessages(10);
    const r = await dispatchMessages(ids, new MockSmsProvider());
    expect(r.retried).toBe(1);
    const m = await db.message.findFirstOrThrow({});
    expect(m.status).toBe("QUEUED");
    expect(m.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(m.attempts).toBe(1);
  });

  it("applies each delivery event once and never moves a final status backwards", async () => {
    const { ctx, org } = await createTenant({ balance: 10 });
    const [msg] = (await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345671" }], mode: "single" })).accepted;
    const failed = { messageId: msg.id, status: "FAILED" as const, source: "PROVIDER_WEBHOOK" as const, dedupeKey: "evt-1", description: "Unreachable" };
    expect(await applyStatusUpdate(failed)).toBe("applied");
    expect(await applyStatusUpdate(failed)).toBe("duplicate");
    expect(await applyStatusUpdate({ ...failed, status: "DELIVERED", dedupeKey: "evt-2" })).toBe("stale");
    const m = await db.message.findUniqueOrThrow({ where: { id: msg.id } });
    expect(m.status).toBe("FAILED");
    expect(await db.walletTransaction.count({ where: { organizationId: org.id, reason: "REFUND" } })).toBe(1);
    expect(await balanceOf(org.id)).toBeCloseTo(10);
  });

  it("queues signed customer webhook deliveries for final statuses", async () => {
    const { ctx, org } = await createTenant({ balance: 10 });
    const { encryptSecret } = await import("@/lib/crypto");
    await db.webhookEndpoint.create({ data: { organizationId: org.id, url: "https://hooks.example.com/sms", secretEncrypted: encryptSecret("whsec_x"), events: ["message.delivered"] } });
    const [msg] = (await sendMessages(ctx, { ...base, recipients: [{ phone: "01712345671" }], mode: "single" })).accepted;
    await applyStatusUpdate({ messageId: msg.id, status: "DELIVERED", source: "PROVIDER_WEBHOOK", dedupeKey: "d-1" });
    const d = await db.webhookDelivery.findFirstOrThrow({});
    expect(d.event).toBe("message.delivered");
    expect((d.payload as { data: { message_id: string } }).data.message_id).toBe(msg.id);
  });
});
