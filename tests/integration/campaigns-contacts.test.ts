import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createContact, getContact, importContacts, bulkContacts, listContacts } from "@/features/contacts/service";
import { contactSchema } from "@/features/contacts/schemas";
import { cancelCampaign, submitCampaign } from "@/features/campaigns/service";
import { finalizeCampaigns, launchCampaign } from "@/services/messaging/campaign-runner";
import { claimQueuedMessages, dispatchMessages } from "@/services/messaging/dispatcher";
import { MockSmsProvider } from "@/services/sms/mock-provider";
import { clearSettingsCache } from "@/services/settings";
import { balanceOf, createTenant, resetDatabase } from "../support/factories";

const composer = (over: Record<string, unknown> = {}) => ({
  name: "Test campaign",
  smsType: "TRANSACTIONAL" as const,
  senderId: "",
  message: "Hello {{name}}",
  groupIds: [] as string[],
  numbers: "",
  scheduleMode: "now" as const,
  scheduledAt: "",
  ...over,
});

describe("contacts", () => {
  beforeEach(resetDatabase);

  it("imports CSV with normalisation, duplicate and invalid reporting, and suppression", async () => {
    const { ctx, org } = await createTenant();
    const group = await db.contactGroup.create({ data: { organizationId: org.id, name: "Imported" } });
    const csv = "Mobile,Name,Consent,City\n01712345678,A,opted_in,Dhaka\n+8801712345678,Dup,,\nbad,X,,\n01812345678,B,opted_out,Sylhet\n";
    const r = await importContacts(ctx, csv, { groupId: group.id, defaultConsent: "UNKNOWN" });
    expect(r).toMatchObject({ total: 4, created: 2, updated: 0, duplicates: 1, suppressed: 1 });
    expect(r.invalid).toEqual([{ row: 4, value: "bad", reason: expect.any(String) }]);
    const c = await db.contact.findFirstOrThrow({ where: { phone: "+8801712345678" } });
    expect(c.customFields).toEqual({ city: "Dhaka" });
    expect(await db.contactGroupMember.count({ where: { groupId: group.id } })).toBe(2);
    expect(await db.suppressionEntry.count({ where: { organizationId: org.id } })).toBe(1);
    // Re-import updates instead of duplicating.
    const again = await importContacts(ctx, "phone,name\n01712345678,Renamed\n", { defaultConsent: "UNKNOWN" });
    expect(again).toMatchObject({ created: 0, updated: 1 });
  });

  it("isolates tenants: another organization's contact behaves as not found", async () => {
    const a = await createTenant({ name: "A" });
    const b = await createTenant({ name: "B" });
    const contact = await createContact(a.ctx, contactSchema.parse({ phone: "01712345678", name: "Secret" }));
    await expect(getContact(b.ctx, contact.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listContacts(b.ctx, { page: 1, sort: "newest" })).total).toBe(0);
    // Bulk operations silently ignore foreign ids.
    expect(await bulkContacts(b.ctx, [contact.id], { type: "delete" })).toBe(0);
    expect((await getContact(a.ctx, contact.id)).deletedAt).toBeNull();
  });

  it("restores a soft-deleted contact when the number is added again", async () => {
    const { ctx } = await createTenant();
    const c = await createContact(ctx, contactSchema.parse({ phone: "01712345678" }));
    await bulkContacts(ctx, [c.id], { type: "delete" });
    const again = await createContact(ctx, contactSchema.parse({ phone: "01712345678", name: "Back" }));
    expect(again.id).toBe(c.id);
    expect(again.deletedAt).toBeNull();
  });
});

describe("campaigns", () => {
  beforeEach(async () => {
    await resetDatabase();
    await db.setting.create({ data: { key: "sms.policy", value: { promotionalQuietHours: null } } });
    clearSettingsCache();
  });

  it("launches: charges once, skips opted-out contacts, personalises, then completes", async () => {
    const { ctx, org } = await createTenant({ balance: 50 });
    const group = await db.contactGroup.create({ data: { organizationId: org.id, name: "Customers" } });
    for (const [phone, name, consent] of [
      ["+8801712345671", "Rahim", "OPTED_IN"],
      ["+8801712345672", "Karim", "OPTED_OUT"],
      ["+8801712345673", "Salma", "OPTED_IN"],
    ] as const) {
      const c = await db.contact.create({ data: { organizationId: org.id, phone, name, consentStatus: consent } });
      await db.contactGroupMember.create({ data: { groupId: group.id, contactId: c.id } });
    }
    const { campaign, launchNow } = await submitCampaign(ctx, composer({ smsType: "PROMOTIONAL", groupIds: [group.id], numbers: "01812345678\nnot-a-number" }));
    expect(campaign.status).toBe("SCHEDULED");
    expect(launchNow).toBe(true);
    const r = await launchCampaign(campaign.id);
    expect(r).toMatchObject({ launched: true, messages: 3 });
    // Launching twice is a no-op (atomic claim).
    expect((await launchCampaign(campaign.id)).launched).toBe(false);
    const bodies = (await db.message.findMany({ where: { campaignId: campaign.id }, orderBy: { to: "asc" } })).map((m) => m.body);
    expect(bodies).toContain("Hello Rahim");
    expect(bodies).toContain("Hello Salma");
    const recipients = await db.campaignRecipient.groupBy({ by: ["status"], where: { campaignId: campaign.id }, _count: true });
    expect(Object.fromEntries(recipients.map((g) => [g.status, g._count]))).toMatchObject({ INCLUDED: 3, SKIPPED_SUPPRESSED: 1, SKIPPED_INVALID: 1 });
    expect(await db.walletTransaction.count({ where: { organizationId: org.id, reason: "SMS_CHARGE", referenceType: "campaign" } })).toBe(1);
    expect(await balanceOf(org.id)).toBeCloseTo(50 - 3 * 0.4);
    await dispatchMessages(await claimQueuedMessages(10), new MockSmsProvider());
    await finalizeCampaigns();
    const done = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(done).toMatchObject({ status: "COMPLETED", submittedCount: 3, queuedCount: 0 });
  });

  it("requires review for promotional campaigns when the account is flagged", async () => {
    const { ctx } = await createTenant({ balance: 50, requireCampaignReview: true });
    const { campaign, launchNow } = await submitCampaign(ctx, composer({ smsType: "PROMOTIONAL", numbers: "01712345678" }));
    expect(campaign.status).toBe("PENDING_REVIEW");
    expect(launchNow).toBe(false);
    expect((await launchCampaign(campaign.id)).launched).toBe(false);
  });

  it("rejects campaigns the balance cannot cover", async () => {
    const { ctx } = await createTenant({ balance: 0.1 });
    await expect(submitCampaign(ctx, composer({ numbers: "01712345678\n01712345679" }))).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("cancelling a processing campaign refunds unsent messages", async () => {
    const { ctx, org } = await createTenant({ balance: 50 });
    const { campaign } = await submitCampaign(ctx, composer({ numbers: "01712345671\n01712345672\n01712345673" }));
    await launchCampaign(campaign.id);
    expect(await balanceOf(org.id)).toBeCloseTo(48.8);
    await cancelCampaign(ctx, campaign.id);
    expect(await balanceOf(org.id)).toBeCloseTo(50);
    expect(await db.message.count({ where: { campaignId: campaign.id, status: "CANCELLED" } })).toBe(3);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("CANCELLED");
  });
});
