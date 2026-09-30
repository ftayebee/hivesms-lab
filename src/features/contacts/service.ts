import { Prisma } from "@/generated/prisma/client";
import type { ConsentStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, requirePermission, type TenantContext } from "@/lib/auth/context";
import { normalizeBdPhone } from "@/lib/phone";
import { jsonStringArray } from "@/lib/utils";
import { parseCsv, toCsv, unescapeCsvCell, CSV_MAX_ROWS } from "@/lib/csv";
import type { ContactInput, ContactListQuery } from "./schemas";

/**
 * Contacts, groups and the suppression list. Every query is scoped to ctx.organizationId and
 * every lookup by id uses (id, organizationId), so ids from other tenants behave as not found.
 */
export const CONTACTS_PAGE_SIZE = 25;

function listWhere(ctx: TenantContext, q: Partial<ContactListQuery>): Prisma.ContactWhereInput {
  const where: Prisma.ContactWhereInput = { organizationId: ctx.organizationId, deletedAt: null };
  if (q.q) {
    const phone = normalizeBdPhone(q.q);
    // Text columns use a case-insensitive collation (utf8mb4_unicode_ci), so `contains` ignores case.
    where.OR = [
      { name: { contains: q.q } },
      { email: { contains: q.q } },
      { company: { contains: q.q } },
      { phone: { contains: phone ?? (q.q.replace(/[^\d+]/g, "") || q.q) } },
    ];
  }
  if (q.group) where.groups = { some: { groupId: q.group } };
  if (q.tag) where.tags = { array_contains: [q.tag] };
  if (q.consent) where.consentStatus = q.consent;
  return where;
}

export async function listContacts(ctx: TenantContext, q: ContactListQuery) {
  requirePermission(ctx, "contacts:read");
  const where = listWhere(ctx, q);
  const orderBy: Prisma.ContactOrderByWithRelationInput =
    q.sort === "oldest" ? { createdAt: "asc" } : q.sort === "name" ? { name: "asc" } : { createdAt: "desc" };
  const [rows, total] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * CONTACTS_PAGE_SIZE,
      take: CONTACTS_PAGE_SIZE,
      include: { groups: { select: { group: { select: { id: true, name: true } } } } },
    }),
    db.contact.count({ where }),
  ]);
  return { rows, total };
}

export async function getContact(ctx: TenantContext, id: string) {
  requirePermission(ctx, "contacts:read");
  const c = await db.contact.findFirst({
    where: { id, organizationId: ctx.organizationId, deletedAt: null },
    include: { groups: { select: { groupId: true } } },
  });
  if (!c) throw notFound("Contact");
  return c;
}

async function assertGroupsOwned(ctx: TenantContext, groupIds: string[]) {
  if (!groupIds.length) return;
  const n = await db.contactGroup.count({ where: { id: { in: groupIds }, organizationId: ctx.organizationId, deletedAt: null } });
  if (n !== new Set(groupIds).size) throw new AppError("VALIDATION_ERROR", "One or more groups were not found.");
}

async function syncSuppression(ctx: TenantContext, phone: string, consent: ConsentStatus, source: string) {
  if (consent === "OPTED_OUT") {
    await db.suppressionEntry.upsert({
      where: { organizationId_phone: { organizationId: ctx.organizationId, phone } },
      create: { organizationId: ctx.organizationId, phone, reason: "OPT_OUT", source },
      update: {},
    });
  }
}

export async function createContact(ctx: TenantContext, input: ContactInput) {
  requirePermission(ctx, "contacts:write");
  await assertGroupsOwned(ctx, input.groupIds);
  const existing = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: ctx.organizationId, phone: input.phone } } });
  if (existing && !existing.deletedAt) {
    throw new AppError("CONFLICT", "A contact with this number already exists.", { field: "phone" });
  }
  const data = {
    name: input.name,
    email: input.email,
    company: input.company,
    tags: input.tags,
    customFields: input.customFields as Prisma.InputJsonValue,
    consentStatus: input.consentStatus,
    consentSource: input.consentSource,
    consentAt: input.consentStatus !== "UNKNOWN" ? new Date() : null,
  };
  const contact = await db.$transaction(async (tx) => {
    // Re-adding a previously deleted number restores the record rather than violating uniqueness.
    const c = existing
      ? await tx.contact.update({ where: { id: existing.id }, data: { ...data, deletedAt: null, createdAt: new Date() } })
      : await tx.contact.create({ data: { ...data, organizationId: ctx.organizationId, phone: input.phone } });
    await tx.contactGroupMember.deleteMany({ where: { contactId: c.id } });
    if (input.groupIds.length) await tx.contactGroupMember.createMany({ data: input.groupIds.map((groupId) => ({ groupId, contactId: c.id })), skipDuplicates: true });
    return c;
  });
  await syncSuppression(ctx, contact.phone, contact.consentStatus, "contact form");
  await audit({ action: "contact.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "contact", targetId: contact.id });
  return contact;
}

export async function updateContact(ctx: TenantContext, id: string, input: ContactInput) {
  requirePermission(ctx, "contacts:write");
  const current = await getContact(ctx, id);
  await assertGroupsOwned(ctx, input.groupIds);
  if (input.phone !== current.phone) {
    const clash = await db.contact.findUnique({ where: { organizationId_phone: { organizationId: ctx.organizationId, phone: input.phone } } });
    if (clash && !clash.deletedAt) throw new AppError("CONFLICT", "Another contact already uses this number.", { field: "phone" });
    if (clash) await db.contact.delete({ where: { id: clash.id } }); // remove stale soft-deleted duplicate
  }
  const consentChanged = input.consentStatus !== current.consentStatus;
  const contact = await db.$transaction(async (tx) => {
    const c = await tx.contact.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone,
        email: input.email,
        company: input.company,
        tags: input.tags,
        customFields: input.customFields as Prisma.InputJsonValue,
        consentStatus: input.consentStatus,
        consentSource: input.consentSource,
        ...(consentChanged ? { consentAt: new Date() } : {}),
      },
    });
    await tx.contactGroupMember.deleteMany({ where: { contactId: id } });
    if (input.groupIds.length) await tx.contactGroupMember.createMany({ data: input.groupIds.map((groupId) => ({ groupId, contactId: id })), skipDuplicates: true });
    return c;
  });
  if (consentChanged) await syncSuppression(ctx, contact.phone, contact.consentStatus, "contact edit");
  await audit({ action: "contact.update", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "contact", targetId: id, metadata: consentChanged ? { consent: input.consentStatus } : {} });
  return contact;
}

export type BulkAction =
  | { type: "delete" }
  | { type: "addToGroup"; groupId: string }
  | { type: "removeFromGroup"; groupId: string }
  | { type: "addTag"; tag: string }
  | { type: "setConsent"; consent: ConsentStatus };

export async function bulkContacts(ctx: TenantContext, ids: string[], action: BulkAction) {
  requirePermission(ctx, "contacts:write");
  if (!ids.length) throw new AppError("VALIDATION_ERROR", "Select at least one contact.");
  if (ids.length > 1000) throw new AppError("VALIDATION_ERROR", "Select at most 1,000 contacts at a time.");
  // Only ids that belong to this organization are touched.
  const owned = await db.contact.findMany({ where: { id: { in: ids }, organizationId: ctx.organizationId, deletedAt: null }, select: { id: true, phone: true } });
  const ownedIds = owned.map((c) => c.id);
  if (!ownedIds.length) return 0;

  switch (action.type) {
    case "delete":
      await db.contact.updateMany({ where: { id: { in: ownedIds } }, data: { deletedAt: new Date() } });
      await db.contactGroupMember.deleteMany({ where: { contactId: { in: ownedIds } } });
      break;
    case "addToGroup":
      await assertGroupsOwned(ctx, [action.groupId]);
      await db.contactGroupMember.createMany({ data: ownedIds.map((contactId) => ({ groupId: action.groupId, contactId })), skipDuplicates: true });
      break;
    case "removeFromGroup":
      await assertGroupsOwned(ctx, [action.groupId]);
      await db.contactGroupMember.deleteMany({ where: { groupId: action.groupId, contactId: { in: ownedIds } } });
      break;
    case "addTag": {
      const tag = action.tag.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
      if (!tag) throw new AppError("VALIDATION_ERROR", "Enter a tag.");
      await db.$executeRaw`UPDATE contacts SET tags = JSON_ARRAY_APPEND(tags, '$', ${tag}), updatedAt = ${new Date()}
        WHERE id IN (${Prisma.join(ownedIds)}) AND NOT JSON_CONTAINS(tags, JSON_QUOTE(${tag}))`;
      break;
    }
    case "setConsent":
      await db.contact.updateMany({ where: { id: { in: ownedIds } }, data: { consentStatus: action.consent, consentAt: new Date(), consentSource: "bulk update" } });
      if (action.consent === "OPTED_OUT") {
        await db.suppressionEntry.createMany({
          data: owned.map((c) => ({ organizationId: ctx.organizationId, phone: c.phone, reason: "OPT_OUT" as const, source: "bulk update" })),
          skipDuplicates: true,
        });
      }
      break;
  }
  await audit({ action: `contact.bulk.${action.type}`, actor: actorOf(ctx), organizationId: ctx.organizationId, metadata: { count: ownedIds.length } });
  return ownedIds.length;
}

// ─── Import / export ───

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  invalid: { row: number; value: string; reason: string }[];
  duplicates: number;
  suppressed: number;
}

const HEADER_ALIASES: Record<string, string> = {
  mobile: "phone",
  number: "phone",
  msisdn: "phone",
  phone_number: "phone",
  mobile_number: "phone",
  full_name: "name",
  organisation: "company",
  organization: "company",
  consent_status: "consent",
};
const STANDARD = new Set(["phone", "name", "email", "company", "tags", "consent"]);

/**
 * Imports contacts from CSV text. Numbers are validated and normalised; rows with the same
 * number update the existing contact (fields present in the file win). Opted-out rows are also
 * added to the suppression list. Returns a per-row report of problems.
 */
export async function importContacts(
  ctx: TenantContext,
  csvText: string,
  opts: { groupId?: string | null; defaultConsent: ConsentStatus; consentSource?: string | null },
): Promise<ImportResult> {
  requirePermission(ctx, "contacts:write");
  if (opts.groupId) await assertGroupsOwned(ctx, [opts.groupId]);
  const parsed = parseCsv(csvText);
  const headers = parsed.headers.map((h) => HEADER_ALIASES[h] ?? h);
  if (!headers.includes("phone")) throw new AppError("VALIDATION_ERROR", "The file needs a column named phone (or mobile / number).");
  if (parsed.rows.length === 0) throw new AppError("VALIDATION_ERROR", "The file has no data rows.");
  if (parsed.rows.length >= CSV_MAX_ROWS) throw new AppError("VALIDATION_ERROR", `Import at most ${CSV_MAX_ROWS.toLocaleString("en-US")} rows per file.`);

  const result: ImportResult = { total: parsed.rows.length, created: 0, updated: 0, invalid: [], duplicates: 0, suppressed: 0 };
  const byPhone = new Map<string, Prisma.ContactCreateManyInput>();

  parsed.rows.forEach((raw, i) => {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) row[HEADER_ALIASES[k] ?? k] = unescapeCsvCell(String(v ?? ""));
    const phone = normalizeBdPhone(row.phone);
    if (!phone) {
      result.invalid.push({ row: i + 2, value: (row.phone ?? "").slice(0, 30), reason: "Not a valid Bangladesh mobile number" });
      return;
    }
    if (byPhone.has(phone)) {
      result.duplicates++;
      return;
    }
    const email = row.email?.trim().toLowerCase() || null;
    const consentRaw = (row.consent ?? "").trim().toUpperCase().replace(/[\s-]/g, "_");
    const consent = (["OPTED_IN", "UNKNOWN", "OPTED_OUT"].includes(consentRaw) ? consentRaw : opts.defaultConsent) as ConsentStatus;
    const custom: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) if (!STANDARD.has(k) && v && /^[a-z][a-z0-9_]{0,39}$/.test(k)) custom[k] = v.slice(0, 500);
    byPhone.set(phone, {
      organizationId: ctx.organizationId,
      phone,
      name: row.name?.trim().slice(0, 120) || null,
      email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 254) : null,
      company: row.company?.trim().slice(0, 120) || null,
      tags: (row.tags ?? "")
        .split(/[,;|]/)
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, "-"))
        .filter(Boolean)
        .slice(0, 20),
      customFields: custom,
      consentStatus: consent,
      consentSource: opts.consentSource ?? "CSV import",
      consentAt: consent !== "UNKNOWN" ? new Date() : null,
    });
  });

  const rows = [...byPhone.values()];
  const phones = rows.map((r) => r.phone);
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const chunkPhones = phones.slice(i, i + 2000);
    await db.$transaction(
      async (tx) => {
        const existing = await tx.contact.findMany({ where: { organizationId: ctx.organizationId, phone: { in: chunkPhones } }, select: { id: true, phone: true } });
        const existingBy = new Map(existing.map((e) => [e.phone, e.id]));
        const toCreate = chunk.filter((r) => !existingBy.has(r.phone));
        if (toCreate.length) await tx.contact.createMany({ data: toCreate, skipDuplicates: true });
        for (const r of chunk.filter((x) => existingBy.has(x.phone))) {
          await tx.contact.update({
            where: { id: existingBy.get(r.phone)! },
            data: {
              deletedAt: null,
              ...(r.name ? { name: r.name } : {}),
              ...(r.email ? { email: r.email } : {}),
              ...(r.company ? { company: r.company } : {}),
              ...((r.tags as string[]).length ? { tags: r.tags } : {}),
              ...(Object.keys(r.customFields as object).length ? { customFields: r.customFields } : {}),
              consentStatus: r.consentStatus,
              consentAt: r.consentAt,
              consentSource: r.consentSource,
            },
          });
        }
        result.created += toCreate.length;
        result.updated += chunk.length - toCreate.length;
        if (opts.groupId) {
          const ids = await tx.contact.findMany({ where: { organizationId: ctx.organizationId, phone: { in: chunkPhones } }, select: { id: true } });
          await tx.contactGroupMember.createMany({ data: ids.map((c) => ({ groupId: opts.groupId!, contactId: c.id })), skipDuplicates: true });
        }
        const optedOut = chunk.filter((r) => r.consentStatus === "OPTED_OUT");
        if (optedOut.length) {
          const s = await tx.suppressionEntry.createMany({
            data: optedOut.map((r) => ({ organizationId: ctx.organizationId, phone: r.phone, reason: "OPT_OUT" as const, source: "CSV import" })),
            skipDuplicates: true,
          });
          result.suppressed += s.count;
        }
      },
      { timeout: 60_000 },
    );
  }
  await audit({
    action: "contact.import",
    actor: actorOf(ctx),
    organizationId: ctx.organizationId,
    metadata: { total: result.total, created: result.created, updated: result.updated, invalid: result.invalid.length, duplicates: result.duplicates },
  });
  result.invalid = result.invalid.slice(0, 200);
  return result;
}

export async function exportContactsCsv(ctx: TenantContext, q: Partial<ContactListQuery>) {
  requirePermission(ctx, "contacts:export");
  const rows = await db.contact.findMany({
    where: listWhere(ctx, q),
    orderBy: { createdAt: "desc" },
    take: CSV_MAX_ROWS,
    include: { groups: { select: { group: { select: { name: true } } } } },
  });
  const customKeys = [...new Set(rows.flatMap((r) => Object.keys((r.customFields as Record<string, unknown>) ?? {})))].sort();
  const csv = toCsv(
    ["phone", "name", "email", "company", "tags", "groups", "consent", "consent_source", "created_at", ...customKeys],
    rows.map((r) => [
      r.phone,
      r.name,
      r.email,
      r.company,
      jsonStringArray(r.tags).join(","),
      r.groups.map((g) => g.group.name).join(","),
      r.consentStatus,
      r.consentSource,
      r.createdAt,
      ...customKeys.map((k) => (r.customFields as Record<string, unknown>)?.[k] ?? ""),
    ]),
  );
  await audit({ action: "contact.export", actor: actorOf(ctx), organizationId: ctx.organizationId, metadata: { count: rows.length } });
  return csv;
}

// ─── Groups ───

export async function listGroups(ctx: TenantContext) {
  requirePermission(ctx, "contacts:read");
  const groups = await db.contactGroup.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    orderBy: { name: "asc" },
    include: { _count: { select: { members: { where: { contact: { deletedAt: null } } } } } },
  });
  return groups.map((g) => ({ id: g.id, name: g.name, description: g.description, count: g._count.members, createdAt: g.createdAt }));
}

export async function saveGroup(ctx: TenantContext, input: { name: string; description: string | null }, id?: string) {
  requirePermission(ctx, "contacts:write");
  const clash = await db.contactGroup.findFirst({ where: { organizationId: ctx.organizationId, name: input.name, ...(id ? { id: { not: id } } : {}) } });
  if (clash && !clash.deletedAt) throw new AppError("CONFLICT", "A group with this name already exists.", { field: "name" });
  if (clash?.deletedAt) await db.contactGroup.delete({ where: { id: clash.id } });
  if (id) {
    const g = await db.contactGroup.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null } });
    if (!g) throw notFound("Group");
    return db.contactGroup.update({ where: { id }, data: input });
  }
  const g = await db.contactGroup.create({ data: { ...input, organizationId: ctx.organizationId } });
  await audit({ action: "group.create", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "group", targetId: g.id });
  return g;
}

export async function deleteGroup(ctx: TenantContext, id: string) {
  requirePermission(ctx, "contacts:write");
  const g = await db.contactGroup.findFirst({ where: { id, organizationId: ctx.organizationId, deletedAt: null } });
  if (!g) throw notFound("Group");
  await db.$transaction([db.contactGroupMember.deleteMany({ where: { groupId: id } }), db.contactGroup.update({ where: { id }, data: { deletedAt: new Date() } })]);
  await audit({ action: "group.delete", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "group", targetId: id });
}

// ─── Suppression list ───

export async function listSuppression(ctx: TenantContext, page: number, q?: string) {
  requirePermission(ctx, "contacts:read");
  const where: Prisma.SuppressionEntryWhereInput = { organizationId: ctx.organizationId, ...(q ? { phone: { contains: normalizeBdPhone(q) ?? q.replace(/[^\d+]/g, "") } } : {}) };
  const [rows, total] = await Promise.all([
    db.suppressionEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * CONTACTS_PAGE_SIZE, take: CONTACTS_PAGE_SIZE }),
    db.suppressionEntry.count({ where }),
  ]);
  return { rows, total };
}

export async function addSuppression(ctx: TenantContext, input: { phone: string; reason: "OPT_OUT" | "MANUAL" | "COMPLAINT" | "INVALID"; note: string | null }) {
  requirePermission(ctx, "contacts:write");
  const entry = await db.suppressionEntry.upsert({
    where: { organizationId_phone: { organizationId: ctx.organizationId, phone: input.phone } },
    create: { organizationId: ctx.organizationId, phone: input.phone, reason: input.reason, note: input.note, source: "manual" },
    update: { reason: input.reason, note: input.note },
  });
  await db.contact.updateMany({ where: { organizationId: ctx.organizationId, phone: input.phone }, data: { consentStatus: "OPTED_OUT", consentAt: new Date(), consentSource: "suppression list" } });
  await audit({ action: "suppression.add", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "suppression", targetId: entry.id });
  return entry;
}

export async function removeSuppression(ctx: TenantContext, id: string) {
  requirePermission(ctx, "contacts:write");
  const e = await db.suppressionEntry.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!e) throw notFound("Entry");
  await db.suppressionEntry.delete({ where: { id } });
  await audit({ action: "suppression.remove", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "suppression", targetId: id, metadata: { reason: e.reason } });
}

export async function allTags(ctx: TenantContext): Promise<string[]> {
  // Tags are JSON arrays; distinct values are collected here because JSON_TABLE is not available
  // on MariaDB < 10.6. Only rows that have tags are read.
  const rows = await db.$queryRaw<{ tags: string }[]>`
    SELECT tags FROM contacts WHERE organizationId = ${ctx.organizationId} AND deletedAt IS NULL AND JSON_LENGTH(tags) > 0`;
  const tags = new Set<string>();
  for (const r of rows) for (const t of jsonStringArray(typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags)) tags.add(t);
  return [...tags].sort().slice(0, 200);
}
