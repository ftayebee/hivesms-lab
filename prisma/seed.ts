/**
 * Demo seed. ALL DATA IS FICTIONAL: organizations, people, numbers and messages are invented
 * for demonstration and testing. Phone numbers are random values in valid BD format; with the
 * mock SMS provider nothing is ever sent to them.
 *
 * Demo sign-ins (development only; never use these credentials in production):
 *   Platform admin:          admin@smsflow.test      / Demo#Flow2026
 *   Demo org owner:          owner@padma.test        / Demo#Flow2026
 *   Demo org manager:        manager@padma.test      / Demo#Flow2026
 *   Demo org developer:      dev@padma.test          / Demo#Flow2026
 *   Second org owner:        owner@meghna.test       / Demo#Flow2026
 *
 * Run: npm run db:seed   (idempotent: wipes and recreates demo data)
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Decimal } from "decimal.js";
import type { Prisma } from "../src/generated/prisma/client";
import type { MessageStatus } from "../src/generated/prisma/enums";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { encryptSecret } from "../src/lib/crypto";
import { generateApiKey } from "../src/lib/api/api-keys";
import { detectOperator } from "../src/lib/phone";
import { calculateSegments } from "../src/lib/sms-segments";
import { topUpBreakdown } from "../src/lib/pricing";
import { defaultCreditPackages, defaultPlans } from "../src/config/pricing";
import { createOrganizationWithOwner, ensurePermissionCatalogue } from "../src/features/organizations/provision";

export const DEMO_PASSWORD = "Demo#Flow2026";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_DEMO !== "true") {
  console.error("Refusing to seed demo data in production. Set SEED_ALLOW_DEMO=true to override (staging only).");
  process.exit(1);
}

// Deterministic PRNG so demo data is stable between runs.
let seed = 20260930;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const DAY = 86_400_000;

const FIRST = ["Arif", "Nusrat", "Tanvir", "Farhana", "Rakib", "Sadia", "Imran", "Tasnim", "Mahmud", "Jannat", "Shakil", "Rumana", "Fahad", "Mim", "Sabbir", "Anika", "Rafiq", "Tahmina", "Nayeem", "Sumaiya"];
const LAST = ["Hossain", "Rahman", "Akter", "Islam", "Chowdhury", "Ahmed", "Karim", "Sultana", "Uddin", "Haque", "Siddique", "Begum", "Mia", "Sarkar", "Talukder"];
const PREFIXES = ["013", "014", "015", "016", "017", "018", "019"];

function fakePhone() {
  // Avoid mock-provider trigger suffixes (0000, 8888, 9999) for "normal" demo contacts.
  let tail: string;
  do tail = String(int(10000000, 99999999));
  while (/(0000|8888|9999)$/.test(tail));
  return `+88${pick(PREFIXES)}${tail}`;
}

async function wipe() {
  // Order respects foreign keys. Only used on development databases.
  await db.$transaction([
    db.webhookDelivery.deleteMany(),
    db.messageEvent.deleteMany(),
    db.campaignRecipient.deleteMany(),
    db.message.deleteMany(),
    db.campaign.deleteMany(),
    db.invoice.deleteMany(),
    db.payment.deleteMany(),
    db.walletTransaction.deleteMany(),
    db.wallet.deleteMany(),
    db.supportMessage.deleteMany(),
    db.supportTicket.deleteMany(),
    db.notification.deleteMany(),
    db.notificationPreference.deleteMany(),
    db.auditLog.deleteMany(),
    db.apiLog.deleteMany(),
    db.apiKey.deleteMany(),
    db.idempotencyKey.deleteMany(),
    db.webhookEndpoint.deleteMany(),
    db.inboundWebhookEvent.deleteMany(),
    db.contactGroupMember.deleteMany(),
    db.contactGroup.deleteMany(),
    db.contact.deleteMany(),
    db.suppressionEntry.deleteMany(),
    db.template.deleteMany(),
    db.senderId.deleteMany(),
    db.invitation.deleteMany(),
    db.organizationMember.deleteMany(),
    db.rolePermission.deleteMany(),
    db.role.deleteMany(),
    db.organization.deleteMany(),
    db.session.deleteMany(),
    db.verificationToken.deleteMany(),
    db.user.deleteMany(),
    db.pricingPlan.deleteMany(),
    db.creditPackage.deleteMany(),
    db.blocklistEntry.deleteMany(),
    db.abuseReport.deleteMany(),
    db.contactRequest.deleteMany(),
    db.rateLimitBucket.deleteMany(),
    db.setting.deleteMany(),
  ]);
}

async function seedCatalogue() {
  await ensurePermissionCatalogue();
  for (const p of defaultPlans) {
    await db.pricingPlan.create({ data: { ...p, features: p.features } });
  }
  for (const p of defaultCreditPackages) {
    await db.creditPackage.create({ data: { name: p.name, amount: p.amount, bonusPercent: p.bonusPercent, sortOrder: p.sortOrder } });
  }
  await db.blocklistEntry.createMany({
    data: [
      { type: "URL_DOMAIN", value: "blocked-example.invalid", reason: "Example entry: known phishing domain" },
      { type: "KEYWORD", value: "lottery winner claim", reason: "Example entry: common scam phrase" },
    ],
  });
}

async function createUser(email: string, name: string, phone: string, platformRole: "USER" | "ADMIN" | "SUPER_ADMIN" | "SUPPORT" = "USER") {
  return db.user.create({
    data: { email, name, phone, passwordHash: await hashPassword(DEMO_PASSWORD), platformRole, emailVerifiedAt: new Date(), phoneVerifiedAt: new Date() },
  });
}

interface LedgerRow {
  at: Date;
  type: "CREDIT" | "DEBIT";
  reason: "TOPUP" | "SMS_CHARGE" | "REFUND" | "BONUS";
  amount: Decimal;
  description: string;
  referenceType: string;
  referenceId: string;
}

async function seedPadma() {
  const owner = await createUser("owner@padma.test", "Nusrat Jahan (demo)", "+8801711000101");
  const manager = await createUser("manager@padma.test", "Rakib Hasan (demo)", "+8801811000102");
  const developer = await createUser("dev@padma.test", "Tanvir Ahmed (demo)", "+8801911000103");
  const business = await db.pricingPlan.findUniqueOrThrow({ where: { key: "business" } });

  const { org, roles } = await db.$transaction((tx) =>
    createOrganizationWithOwner(tx, { name: "Padma Online Store (Demo)", ownerUserId: owner.id, industry: "E-commerce", pricingPlanId: business.id }),
  );
  await db.organization.update({
    where: { id: org.id },
    data: {
      createdAt: new Date(Date.now() - 120 * DAY),
      website: "https://padma-store.example",
      address: "House 00, Road 00, Dhanmondi, Dhaka (fictional)",
      billingEmail: "accounts@padma.test",
      dailySendLimit: 20000,
      monthlySendLimit: 300000,
      requireCampaignReview: false,
    },
  });
  await db.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: manager.id, roleId: roles.MANAGER, invitedById: owner.id },
      { organizationId: org.id, userId: developer.id, roleId: roles.DEVELOPER, invitedById: owner.id },
    ],
  });
  await db.invitation.create({
    data: {
      organizationId: org.id,
      email: "viewer@padma.test",
      roleId: roles.VIEWER,
      tokenHash: randomUUID().replace(/-/g, ""),
      invitedById: owner.id,
      expiresAt: new Date(Date.now() + 5 * DAY),
    },
  });

  // Sender IDs
  const approvedMask = await db.senderId.create({
    data: {
      organizationId: org.id,
      value: "PADMASHOP",
      type: "MASKING",
      status: "APPROVED",
      purpose: "Order confirmations and delivery updates",
      sampleMessage: "Your order #10234 has been confirmed. Thank you for shopping with Padma.",
      isDefault: true,
      approvedAt: new Date(Date.now() - 90 * DAY),
      reviewedAt: new Date(Date.now() - 90 * DAY),
      submittedById: owner.id,
    },
  });
  await db.senderId.createMany({
    data: [
      {
        organizationId: org.id,
        value: "8809612345678",
        type: "NON_MASKING",
        status: "APPROVED",
        purpose: "Two-way customer support number",
        approvedAt: new Date(Date.now() - 100 * DAY),
        reviewedAt: new Date(Date.now() - 100 * DAY),
      },
      {
        organizationId: org.id,
        value: "PADMAOFFER",
        type: "MASKING",
        status: "PENDING",
        purpose: "Seasonal promotions to opted-in customers",
        sampleMessage: "Eid offer: 15% off selected items this week. Reply STOP to opt out.",
        submittedById: manager.id,
        createdAt: new Date(Date.now() - 2 * DAY),
      },
      {
        organizationId: org.id,
        value: "PADMADEAL",
        type: "MASKING",
        status: "REJECTED",
        purpose: "Flash deals",
        rejectionReason: "Supporting trade licence was not attached. Resubmit with the document.",
        reviewedAt: new Date(Date.now() - 20 * DAY),
        submittedById: manager.id,
      },
    ],
  });

  // Contacts and groups
  const groups = await Promise.all(
    ["VIP customers", "Dhaka customers", "Newsletter subscribers"].map((name) =>
      db.contactGroup.create({ data: { organizationId: org.id, name, description: `Demo group: ${name.toLowerCase()}` } }),
    ),
  );
  const contacts: { id: string; phone: string; name: string }[] = [];
  const usedPhones = new Set<string>();
  for (let i = 0; i < 80; i++) {
    let phone = fakePhone();
    while (usedPhones.has(phone)) phone = fakePhone();
    usedPhones.add(phone);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const consent = i % 17 === 0 ? "OPTED_OUT" : i % 3 === 0 ? "UNKNOWN" : "OPTED_IN";
    const c = await db.contact.create({
      data: {
        organizationId: org.id,
        name,
        phone,
        email: i % 4 === 0 ? `${name.split(" ")[0].toLowerCase()}${i}@example.com` : null,
        company: i % 6 === 0 ? pick(["Karnaphuli Traders", "Jamuna Textiles", "Surma Foods"]) + " (fictional)" : null,
        tags: [pick(["repeat-buyer", "new", "wholesale", "app-user"]), ...(i % 5 === 0 ? ["eid-2026"] : [])],
        customFields: { city: pick(["Dhaka", "Chattogram", "Sylhet", "Khulna", "Rajshahi"]), last_order: `#${10000 + i}` },
        consentStatus: consent,
        consentSource: consent === "OPTED_IN" ? "Checkout form" : null,
        consentAt: consent === "OPTED_IN" ? new Date(Date.now() - int(10, 200) * DAY) : null,
        createdAt: new Date(Date.now() - int(1, 110) * DAY),
      },
    });
    contacts.push({ id: c.id, phone, name });
    const memberships = [groups[2]];
    if (i % 4 === 0) memberships.push(groups[0]);
    if (i % 2 === 0) memberships.push(groups[1]);
    await db.contactGroupMember.createMany({ data: memberships.map((g) => ({ groupId: g.id, contactId: c.id })) });
    if (consent === "OPTED_OUT") {
      await db.suppressionEntry.create({ data: { organizationId: org.id, phone, reason: "OPT_OUT", source: "STOP keyword" } });
    }
  }
  await db.suppressionEntry.create({ data: { organizationId: org.id, phone: "+8801700000123", reason: "MANUAL", source: "manual", note: "Customer asked by phone to stop messages" } });

  // Templates
  await db.template.createMany({
    data: [
      { organizationId: org.id, name: "OTP", body: "Your Padma verification code is {{code}}. It expires in 5 minutes. Do not share it.", smsType: "TRANSACTIONAL", createdById: developer.id },
      { organizationId: org.id, name: "Order confirmed", body: "Hi {{name}}, your order {{last_order}} is confirmed. We will text you when it ships.", smsType: "TRANSACTIONAL", createdById: manager.id },
      { organizationId: org.id, name: "Out for delivery", body: "Your Padma order is out for delivery today. Keep your phone reachable.", smsType: "TRANSACTIONAL", createdById: manager.id },
      { organizationId: org.id, name: "Eid offer (Bangla)", body: "ঈদ অফার: নির্বাচিত পণ্যে ১৫% ছাড়। অফার চলবে সপ্তাহজুড়ে। বন্ধ করতে STOP লিখুন।", smsType: "PROMOTIONAL", createdById: manager.id },
    ],
  });

  // ── Historical traffic (last 30 days) ──
  const rate = new Decimal(business.transactionalMasking.toString());
  const promoRate = new Decimal(business.promotionalMasking.toString());
  const ledger: LedgerRow[] = [];
  const messages: Prisma.MessageCreateManyInput[] = [];
  const events: Prisma.MessageEventCreateManyInput[] = [];

  // Top-ups (payments + invoices)
  const topups = [
    { daysAgo: 35, amount: 10000, pkg: "BDT 10,000", bonus: 3 },
    { daysAgo: 18, amount: 5000, pkg: "BDT 5,000", bonus: 2 },
    { daysAgo: 6, amount: 5000, pkg: "BDT 5,000", bonus: 2 },
  ];
  const packages = await db.creditPackage.findMany();
  for (const t of topups) {
    const b = topUpBreakdown(t.amount, 15, t.bonus);
    const at = new Date(Date.now() - t.daysAgo * DAY);
    const payment = await db.payment.create({
      data: {
        organizationId: org.id,
        provider: "manual",
        providerRef: `DEMO-BANK-${t.daysAgo}`,
        packageId: packages.find((p) => p.name === t.pkg)?.id,
        amount: b.subtotal.toString(),
        vatRate: "15",
        vatAmount: b.vatAmount.toString(),
        total: b.total.toString(),
        creditAmount: b.creditAmount.toString(),
        status: "SUCCEEDED",
        method: "Bank transfer",
        manualReference: `DEMO-TRX-${1000 + t.daysAgo}`,
        initiatedById: owner.id,
        completedAt: at,
        createdAt: at,
      },
    });
    const n = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
    await db.invoice.create({
      data: {
        organizationId: org.id,
        paymentId: payment.id,
        number: `INV-${at.getUTCFullYear()}-${String(n[0].n).padStart(6, "0")}`,
        subtotal: b.subtotal.toString(),
        vatRate: "15",
        vatAmount: b.vatAmount.toString(),
        total: b.total.toString(),
        billingName: "Padma Online Store (Demo)",
        billingEmail: "accounts@padma.test",
        lineItems: [{ description: "SMS wallet top-up", quantity: 1, unitPrice: b.subtotal.toString(), amount: b.subtotal.toString() }],
        issuedAt: at,
        createdAt: at,
      },
    });
    ledger.push({ at, type: "CREDIT", reason: "TOPUP", amount: b.creditAmount, description: "Top-up (Bank transfer)", referenceType: "payment", referenceId: payment.id });
  }

  const apiKey = generateApiKey();
  const liveKey = await db.apiKey.create({
    data: {
      organizationId: org.id,
      name: "Production checkout server",
      prefix: apiKey.prefix,
      keyHash: apiKey.keyHash,
      scopes: ["sms:send", "messages:read", "balance:read", "sender_ids:read"],
      createdById: developer.id,
      lastUsedAt: new Date(Date.now() - 20 * 60_000),
      lastUsedIp: "203.0.113.24",
      createdAt: new Date(Date.now() - 60 * DAY),
    },
  });
  const oldKey = generateApiKey();
  await db.apiKey.create({
    data: {
      organizationId: org.id,
      name: "Staging (old)",
      prefix: oldKey.prefix,
      keyHash: oldKey.keyHash,
      scopes: ["sms:send", "messages:read"],
      status: "REVOKED",
      revokedAt: new Date(Date.now() - 25 * DAY),
      revokedById: owner.id,
      createdById: developer.id,
      createdAt: new Date(Date.now() - 90 * DAY),
    },
  });

  function addMessage(opts: {
    at: Date;
    to: string;
    body: string;
    smsType: "TRANSACTIONAL" | "PROMOTIONAL";
    source: "API" | "CAMPAIGN" | "DASHBOARD";
    campaignId?: string;
    unitRate: Decimal;
    forceStatus?: MessageStatus;
  }) {
    const seg = calculateSegments(opts.body);
    const cost = opts.unitRate.mul(seg.segments);
    const roll = rand();
    const recent = Date.now() - opts.at.getTime() < 10 * 60_000;
    const status: MessageStatus = opts.forceStatus ?? (recent ? "SUBMITTED" : roll < 0.925 ? "DELIVERED" : roll < 0.965 ? "FAILED" : roll < 0.985 ? "REJECTED" : "EXPIRED");
    const id = randomUUID();
    const submittedAt = new Date(opts.at.getTime() + int(1, 4) * 1000);
    const finalAt = new Date(submittedAt.getTime() + int(3, 40) * 1000);
    const failure =
      status === "FAILED"
        ? pick([
            ["UNDELIV", "Handset unreachable or switched off"],
            ["ABSENT", "Subscriber absent"],
            ["NETWORK", "Operator network error"],
          ])
        : status === "REJECTED"
          ? ["REJECTD", "Rejected by operator"]
          : status === "EXPIRED"
            ? ["EXPIRED", "Message validity period expired"]
            : null;
    messages.push({
      id,
      organizationId: org.id,
      campaignId: opts.campaignId,
      apiKeyId: opts.source === "API" ? liveKey.id : null,
      source: opts.source,
      to: opts.to,
      operator: detectOperator(opts.to),
      senderValue: approvedMask.value,
      senderType: "MASKING",
      smsType: opts.smsType,
      body: opts.body,
      encoding: seg.encoding,
      segments: seg.segments,
      unitPrice: opts.unitRate.toString(),
      cost: cost.toString(),
      status,
      provider: "mock",
      providerMessageId: `demo_${id.slice(0, 18)}`,
      errorCode: failure?.[0],
      errorMessage: failure?.[1],
      attempts: 1,
      nextAttemptAt: null,
      queuedAt: opts.at,
      submittedAt: status === "REJECTED" ? null : submittedAt,
      deliveredAt: status === "DELIVERED" ? finalAt : null,
      failedAt: failure ? finalAt : null,
      refundedAt: failure && status !== "EXPIRED" ? finalAt : null,
      createdAt: opts.at,
      updatedAt: finalAt,
    });
    events.push({ messageId: id, status: "QUEUED", source: "SYSTEM", dedupeKey: `seed-q:${id}`, occurredAt: opts.at, description: "Queued" });
    if (status !== "REJECTED") events.push({ messageId: id, status: "SUBMITTED", source: "PROVIDER_RESPONSE", dedupeKey: `seed-s:${id}`, occurredAt: submittedAt, description: "Accepted by provider" });
    if (status !== "SUBMITTED") {
      events.push({ messageId: id, status, source: "PROVIDER_WEBHOOK", providerStatus: failure?.[0] ?? "DELIVRD", dedupeKey: `seed-f:${id}`, occurredAt: finalAt, description: failure?.[1] ?? "Delivered" });
    }
    if (failure && status !== "EXPIRED") {
      ledger.push({ at: finalAt, type: "CREDIT", reason: "REFUND", amount: cost, description: `Refund: ${status.toLowerCase()} message to ${opts.to}`, referenceType: "message", referenceId: id });
    }
    return { cost, status };
  }

  // API transactional traffic: daily batches
  const txBodies = [
    () => `Your Padma verification code is ${int(100000, 999999)}. It expires in 5 minutes. Do not share it.`,
    () => `Hi, your order #${int(10000, 99999)} is confirmed. We will text you when it ships.`,
    () => "Your Padma order is out for delivery today. Keep your phone reachable.",
    () => `Payment of BDT ${int(300, 9000)} received for order #${int(10000, 99999)}. Thank you.`,
  ];
  for (let d = 29; d >= 0; d--) {
    const dayStart = Date.now() - d * DAY;
    const count = int(18, 55) + (d % 7 === 4 ? 25 : 0);
    let dayCost = new Decimal(0);
    for (let i = 0; i < count; i++) {
      const at = new Date(dayStart - int(0, 20) * 3600_000 - int(0, 59) * 60_000);
      if (at.getTime() > Date.now()) continue;
      const r = addMessage({ at, to: pick(contacts).phone, body: pick(txBodies)(), smsType: "TRANSACTIONAL", source: "API", unitRate: rate });
      dayCost = dayCost.plus(r.cost);
    }
    ledger.push({ at: new Date(dayStart - 21 * 3600_000), type: "DEBIT", reason: "SMS_CHARGE", amount: dayCost, description: `API sends (${count} messages)`, referenceType: "send_batch", referenceId: randomUUID() });
  }

  // Campaigns
  const campaignDefs = [
    { name: "Pohela Boishakh greetings", daysAgo: 26, groups: [groups[2]], type: "PROMOTIONAL" as const, body: "শুভ নববর্ষ! Padma-র পক্ষ থেকে আপনাকে নববর্ষের শুভেচ্ছা। বন্ধ করতে STOP লিখুন।" },
    { name: "VIP early access", daysAgo: 15, groups: [groups[0]], type: "PROMOTIONAL" as const, body: "Hi {{name}}, VIP early access to our new collection starts tomorrow at 10am. Reply STOP to opt out." },
    { name: "Delivery delay notice (Dhaka)", daysAgo: 9, groups: [groups[1]], type: "TRANSACTIONAL" as const, body: "Due to heavy rain, deliveries in Dhaka may be delayed by one day. Sorry for the inconvenience." },
    { name: "Weekend offer", daysAgo: 3, groups: [groups[2]], type: "PROMOTIONAL" as const, body: "Weekend offer: free delivery on orders above BDT 1,500 until Saturday. Reply STOP to opt out." },
  ];
  const optedOut = new Set((await db.suppressionEntry.findMany({ where: { organizationId: org.id } })).map((s) => s.phone));
  for (const def of campaignDefs) {
    const campaignId = randomUUID();
    const at = new Date(Date.now() - def.daysAgo * DAY + 3 * 3600_000);
    const members = await db.contactGroupMember.findMany({ where: { groupId: { in: def.groups.map((g) => g.id) } }, include: { contact: true } });
    const unit = def.type === "PROMOTIONAL" ? promoRate : rate;
    const seg = calculateSegments(def.body);
    let delivered = 0,
      failed = 0,
      submitted = 0,
      skipped = 0;
    let total = new Decimal(0);
    let refunded = new Decimal(0);
    const recipients: Prisma.CampaignRecipientCreateManyInput[] = [];
    await db.campaign.create({
      data: {
        id: campaignId,
        organizationId: org.id,
        name: def.name,
        smsType: def.type,
        senderIdId: approvedMask.id,
        senderValue: approvedMask.value,
        senderType: "MASKING",
        message: def.body,
        encoding: seg.encoding,
        segmentsPerMessage: seg.segments,
        status: "COMPLETED",
        audience: { groupIds: def.groups.map((g) => g.id), numbers: [] },
        scheduledAt: at,
        startedAt: at,
        completedAt: new Date(at.getTime() + 15 * 60_000),
        createdById: manager.id,
        createdAt: new Date(at.getTime() - 2 * DAY),
      },
    });
    for (const m of members) {
      if (def.type === "PROMOTIONAL" && optedOut.has(m.contact.phone)) {
        skipped++;
        recipients.push({ campaignId, contactId: m.contactId, phone: m.contact.phone, status: "SKIPPED_SUPPRESSED" });
        continue;
      }
      const body = def.body.replace("{{name}}", m.contact.name ?? "");
      const r = addMessage({ at: new Date(at.getTime() + int(0, 600) * 1000), to: m.contact.phone, body, smsType: def.type, source: "CAMPAIGN", campaignId, unitRate: unit });
      const msgId = messages[messages.length - 1].id!;
      recipients.push({ campaignId, contactId: m.contactId, phone: m.contact.phone, status: "INCLUDED", messageId: msgId });
      total = total.plus(r.cost);
      if (r.status !== "REJECTED") submitted++;
      if (r.status === "DELIVERED") delivered++;
      else if (r.status !== "SUBMITTED") {
        failed++;
        if (r.status !== "EXPIRED") refunded = refunded.plus(r.cost);
      }
    }
    await db.campaign.update({
      where: { id: campaignId },
      data: {
        recipientCount: recipients.length,
        skippedCount: skipped,
        submittedCount: submitted,
        deliveredCount: delivered,
        failedCount: failed,
        estimatedCost: total.toString(),
        actualCost: total.minus(refunded).toString(),
        refundedAmount: refunded.toString(),
      },
    });
    await db.campaignRecipient.createMany({ data: recipients });
    ledger.push({ at, type: "DEBIT", reason: "SMS_CHARGE", amount: total, description: `Campaign "${def.name}" (${recipients.length - skipped} recipients)`, referenceType: "campaign", referenceId: campaignId });
  }

  // Non-sent campaigns in other states
  const seg = calculateSegments("Flash sale: 20% off kitchenware this Friday only. Reply STOP to opt out.");
  const base = {
    organizationId: org.id,
    smsType: "PROMOTIONAL" as const,
    senderIdId: approvedMask.id,
    senderValue: approvedMask.value,
    senderType: "MASKING" as const,
    encoding: seg.encoding,
    segmentsPerMessage: seg.segments,
    createdById: manager.id,
    audience: { groupIds: [groups[2].id], numbers: [] },
  };
  await db.campaign.createMany({
    data: [
      { ...base, name: "Friday flash sale", message: "Flash sale: 20% off kitchenware this Friday only. Reply STOP to opt out.", status: "SCHEDULED", scheduledAt: new Date(Date.now() + 2 * DAY), estimatedCost: "38.50", recipientCount: 0 },
      { ...base, name: "Loyalty points reminder (draft)", message: "Hi {{name}}, you have unused loyalty points. Use them before the month ends.", status: "DRAFT" },
      { ...base, name: "Cancelled test blast", message: "Test message, please ignore.", status: "CANCELLED", cancelledAt: new Date(Date.now() - 12 * DAY), createdAt: new Date(Date.now() - 13 * DAY) },
    ],
  });

  // Insert messages/events in chunks
  for (let i = 0; i < messages.length; i += 1000) await db.message.createMany({ data: messages.slice(i, i + 1000) });
  for (let i = 0; i < events.length; i += 2000) await db.messageEvent.createMany({ data: events.slice(i, i + 2000) });

  // Ledger in chronological order with running balance
  ledger.sort((a, b) => a.at.getTime() - b.at.getTime());
  const wallet = await db.wallet.findUniqueOrThrow({ where: { organizationId: org.id } });
  let balance = new Decimal(0);
  const txRows: Prisma.WalletTransactionCreateManyInput[] = [];
  for (const l of ledger) {
    if (l.amount.lte(0)) continue;
    balance = l.type === "CREDIT" ? balance.plus(l.amount) : balance.minus(l.amount);
    if (balance.lt(0)) throw new Error("Seed ledger went negative; adjust demo top-ups");
    txRows.push({
      walletId: wallet.id,
      organizationId: org.id,
      type: l.type,
      reason: l.reason,
      amount: l.amount.toFixed(4),
      balanceAfter: balance.toFixed(4),
      description: l.description,
      referenceType: l.referenceType,
      referenceId: l.referenceId,
      createdAt: l.at,
    });
  }
  await db.walletTransaction.createMany({ data: txRows });
  await db.wallet.update({ where: { id: wallet.id }, data: { balance: balance.toFixed(4), lowBalanceThreshold: "500" } });

  // API logs
  const paths = [
    ["POST", "/api/v1/sms/send", 200],
    ["POST", "/api/v1/sms/send", 200],
    ["POST", "/api/v1/sms/send", 422],
    ["GET", "/api/v1/messages/msg", 200],
    ["GET", "/api/v1/balance", 200],
    ["POST", "/api/v1/sms/bulk", 200],
    ["POST", "/api/v1/sms/send", 402],
  ] as const;
  await db.apiLog.createMany({
    data: Array.from({ length: 120 }, (_, i) => {
      const [method, path, status] = pick(paths);
      return {
        organizationId: org.id,
        apiKeyId: liveKey.id,
        requestId: `req_demo${String(i).padStart(10, "0")}`,
        method,
        path: path === "/api/v1/messages/msg" ? `/api/v1/messages/${randomUUID()}` : path,
        statusCode: status,
        durationMs: int(35, 420),
        errorCode: status === 422 ? "INVALID_RECIPIENT" : status === 402 ? "INSUFFICIENT_BALANCE" : null,
        ipAddress: "203.0.113.24",
        userAgent: "padma-checkout/2.3 (node)",
        createdAt: new Date(Date.now() - int(0, 7 * 24 * 60) * 60_000),
      };
    }),
  });

  // Webhook endpoint (example URL; deliveries will fail harmlessly)
  await db.webhookEndpoint.create({
    data: {
      organizationId: org.id,
      url: "https://padma-store.example/webhooks/sms",
      description: "Order service delivery reports (example)",
      secretEncrypted: encryptSecret("whsec_demo_" + randomUUID()),
      events: ["message.delivered", "message.failed"],
      active: false,
    },
  });

  // Support tickets
  const t1 = await db.supportTicket.create({
    data: {
      organizationId: org.id,
      subject: "Masking sender ID PADMAOFFER status",
      category: "Sender ID",
      priority: "NORMAL",
      status: "WAITING_FOR_CUSTOMER",
      createdById: manager.id,
      createdAt: new Date(Date.now() - 2 * DAY),
      lastReplyAt: new Date(Date.now() - 1 * DAY),
    },
  });
  const t2 = await db.supportTicket.create({
    data: {
      organizationId: org.id,
      subject: "Delivery reports delayed for Teletalk numbers",
      category: "Delivery",
      priority: "HIGH",
      status: "RESOLVED",
      createdById: developer.id,
      createdAt: new Date(Date.now() - 12 * DAY),
      lastReplyAt: new Date(Date.now() - 11 * DAY),
    },
  });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@smsflow.test" } });
  await db.supportMessage.createMany({
    data: [
      { ticketId: t1.id, authorId: manager.id, body: "We submitted PADMAOFFER two days ago. Is anything else needed for approval?", createdAt: new Date(Date.now() - 2 * DAY) },
      { ticketId: t1.id, authorId: admin.id, isStaff: true, body: "Thanks for waiting. Please attach a copy of your trade licence to the request so we can forward it for approval.", createdAt: new Date(Date.now() - 1 * DAY) },
      { ticketId: t2.id, authorId: developer.id, body: "Delivery reports for 015 numbers are arriving hours late since yesterday.", createdAt: new Date(Date.now() - 12 * DAY) },
      { ticketId: t2.id, authorId: admin.id, isStaff: true, body: "The upstream route had a reporting delay. It has been fixed and pending reports were backfilled.", createdAt: new Date(Date.now() - 11 * DAY) },
      { ticketId: t2.id, authorId: admin.id, isStaff: true, isInternal: true, body: "Internal: upstream incident reference DEMO-123.", createdAt: new Date(Date.now() - 11 * DAY) },
    ],
  });

  // Notifications
  await db.notification.createMany({
    data: [
      { organizationId: org.id, userId: owner.id, type: "campaign.completed", title: 'Campaign "Weekend offer" completed', body: "Delivery reports are in. Open the campaign for details.", link: "/dashboard/campaigns", createdAt: new Date(Date.now() - 3 * DAY) },
      { organizationId: org.id, userId: owner.id, type: "payment.succeeded", title: "Payment successful", body: "BDT 5,100.00 was added to your wallet.", link: "/dashboard/wallet", createdAt: new Date(Date.now() - 6 * DAY) },
      { organizationId: org.id, userId: owner.id, type: "sender_id.status", title: "Sender ID PADMADEAL was not approved", body: "Supporting trade licence was not attached.", link: "/dashboard/sender-ids", createdAt: new Date(Date.now() - 20 * DAY), readAt: new Date(Date.now() - 19 * DAY) },
    ],
  });

  await db.auditLog.createMany({
    data: [
      { organizationId: org.id, actorType: "USER", actorUserId: developer.id, action: "api_key.create", targetType: "api_key", targetId: liveKey.id, createdAt: new Date(Date.now() - 60 * DAY) },
      { organizationId: org.id, actorType: "USER", actorUserId: owner.id, action: "team.invite", targetType: "invitation", metadata: { email: "viewer@padma.test", role: "VIEWER" }, createdAt: new Date(Date.now() - 2 * DAY) },
      { organizationId: org.id, actorType: "USER", actorUserId: owner.id, action: "auth.login", ipAddress: "203.0.113.10", createdAt: new Date(Date.now() - 3600_000) },
    ],
  });

  return { org, owner };
}

async function seedMeghna() {
  const owner = await createUser("owner@meghna.test", "Farhana Akter (demo)", "+8801611000201");
  const starter = await db.pricingPlan.findUniqueOrThrow({ where: { key: "starter" } });
  const { org } = await db.$transaction((tx) =>
    createOrganizationWithOwner(tx, { name: "Meghna Diagnostics (Demo)", ownerUserId: owner.id, industry: "Healthcare", pricingPlanId: starter.id }),
  );
  await db.contact.createMany({
    data: Array.from({ length: 12 }, () => ({ organizationId: org.id, name: `${pick(FIRST)} ${pick(LAST)}`, phone: fakePhone(), consentStatus: "OPTED_IN" as const })),
    skipDuplicates: true,
  });
  await db.senderId.create({
    data: { organizationId: org.id, value: "MEGHNALAB", type: "MASKING", status: "PENDING", purpose: "Test report ready alerts", sampleMessage: "Your test report is ready. Collect it from the front desk." },
  });
  // A manual payment waiting for admin verification
  const b = topUpBreakdown(2000, 15, 0);
  await db.payment.create({
    data: {
      organizationId: org.id,
      provider: "manual",
      amount: b.subtotal.toString(),
      vatRate: "15",
      vatAmount: b.vatAmount.toString(),
      total: b.total.toString(),
      creditAmount: b.creditAmount.toString(),
      status: "AWAITING_VERIFICATION",
      method: "Bank transfer",
      manualReference: "DEMO-TRX-55821",
      initiatedById: owner.id,
    },
  });
  await db.supportTicket.create({
    data: {
      organizationId: org.id,
      subject: "How do I schedule report-ready alerts?",
      category: "General",
      status: "OPEN",
      createdById: owner.id,
      messages: { create: { authorId: owner.id, body: "Can we schedule messages to go out at 9am the next day?" } },
    },
  });
  // A campaign waiting for review
  const seg = calculateSegments("Free blood sugar screening this Friday at all branches. Reply STOP to opt out.");
  await db.campaign.create({
    data: {
      organizationId: org.id,
      name: "Free screening day",
      smsType: "PROMOTIONAL",
      senderValue: process.env.SMS_DEFAULT_SENDER_ID ?? "8809600000000",
      senderType: "NON_MASKING",
      message: "Free blood sugar screening this Friday at all branches. Reply STOP to opt out.",
      encoding: seg.encoding,
      segmentsPerMessage: seg.segments,
      status: "PENDING_REVIEW",
      audience: { groupIds: [], numbers: ["01711000555", "01811000556"] },
      scheduledAt: new Date(Date.now() + 3 * DAY),
      estimatedCost: "0.80",
      createdById: owner.id,
    },
  });
  return { org };
}

async function main() {
  console.log("Seeding demo data (fictional)...");
  await wipe();
  await seedCatalogue();
  await createUser("admin@smsflow.test", "Platform Admin (demo)", "+8801511000001", "SUPER_ADMIN");
  await createUser("support@smsflow.test", "Support Agent (demo)", "+8801511000002", "SUPPORT");
  await seedPadma();
  await seedMeghna();
  await db.abuseReport.create({
    data: {
      reporterName: "Anonymous (demo)",
      senderValue: "WINPRIZE",
      messageContent: "Congratulations! You are a lottery winner. Claim at blocked-example.invalid",
      description: "Unsolicited scam message (demo report).",
    },
  });
  await db.contactRequest.create({
    data: { name: "Sabbir Rahman (demo)", company: "Karnaphuli Traders (fictional)", email: "sabbir@example.com", phone: "01811000999", subject: "Enterprise pricing", message: "We send about 300k OTPs a month. Can we discuss custom rates?" },
  });
  const counts = { users: await db.user.count(), orgs: await db.organization.count(), messages: await db.message.count(), contacts: await db.contact.count() };
  console.log("Done.", counts);
  console.log(`Demo password for all demo users: see DEMO_PASSWORD in prisma/seed.ts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
