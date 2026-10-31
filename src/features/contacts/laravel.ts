import "server-only";
import type { ConsentStatus, SuppressionReason } from "@/generated/prisma/enums";
import { AppError } from "@/lib/errors";
import { laravel, laravelData } from "@/lib/laravel-api";
import { date, pageMeta } from "@/lib/laravel/convert";
import type { ContactInput, ContactListQuery } from "./schemas";
import type { BulkAction, ImportResult } from "./service";

/**
 * Contacts, groups, suppression and imports through the Laravel API (LARAVEL_FEATURES `contacts`).
 * Same return shapes as ./service.ts. Tenant scope is enforced by Laravel from the session: ids of
 * other organizations answer 404 (tested in backend/tests), never another tenant's data.
 */

interface LaravelContact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  company: string | null;
  tags: string[];
  customFields: Record<string, string>;
  consentStatus: ConsentStatus;
  consentSource: string | null;
  consentAt: string | null;
  createdAt: string;
  updatedAt: string;
  groups?: Array<{ id: string; name: string }>;
}

function toContact(c: LaravelContact) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    company: c.company,
    tags: c.tags,
    customFields: c.customFields,
    consentStatus: c.consentStatus,
    consentSource: c.consentSource,
    consentAt: date(c.consentAt),
    createdAt: date(c.createdAt),
    updatedAt: date(c.updatedAt),
    deletedAt: null as Date | null,
    // Prisma include shape used by the contacts page.
    groups: (c.groups ?? []).map((g) => ({ group: { id: g.id, name: g.name } })),
  };
}

export async function listContacts(q: ContactListQuery) {
  const res = await laravel.get<LaravelContact[]>("app/contacts", { q: q.q, group: q.group, tag: q.tag, consent: q.consent, sort: q.sort, page: q.page });
  return { rows: res.data.map(toContact), total: pageMeta(res.meta).total };
}

/** Contact form payload: the parsed form values (Laravel validates again and is authoritative). */
function contactBody(input: ContactInput) {
  return {
    name: input.name,
    phone: input.phone,
    email: input.email,
    company: input.company,
    tags: input.tags,
    groupIds: input.groupIds,
    consentStatus: input.consentStatus,
    consentSource: input.consentSource,
    customFields: input.customFields,
  };
}

export async function createContact(input: ContactInput) {
  return toContact((await laravel.post<LaravelContact>("app/contacts", contactBody(input))).data);
}

export async function updateContact(id: string, input: ContactInput) {
  return toContact((await laravel.put<LaravelContact>(`app/contacts/${encodeURIComponent(id)}`, contactBody(input))).data);
}

export async function bulkContacts(ids: string[], action: BulkAction): Promise<number> {
  return (await laravel.post<{ updated: number }>("app/contacts/bulk", { ids, action })).data.updated;
}

export async function allTags(): Promise<string[]> {
  return laravelData<string[]>("app/contacts/tags");
}

interface ImportAnswer {
  importId: string;
  status: "queued" | "processing" | "completed" | "failed";
  result?: ImportResult;
  error?: string;
}

/**
 * Multipart upload of the original file. Small files are imported synchronously; larger ones are
 * queued by Laravel — then the import status is polled briefly so the dialog can still show the
 * report. If it is still running, a partial result with a "still processing" note is returned.
 */
export async function importContacts(file: File, opts: { groupId?: string | null; defaultConsent: ConsentStatus; consentSource?: string | null }): Promise<{ result: ImportResult | null; pending: boolean }> {
  const form = new FormData();
  form.set("file", file, file.name);
  if (opts.groupId) form.set("groupId", opts.groupId);
  form.set("defaultConsent", opts.defaultConsent);
  if (opts.consentSource) form.set("consentSource", opts.consentSource);
  let answer = (await laravel.post<ImportAnswer>("app/contacts/import", form, { timeoutMs: 120_000 })).data;
  const deadline = Date.now() + 25_000;
  while ((answer.status === "queued" || answer.status === "processing") && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_500));
    answer = await laravelData<ImportAnswer>(`app/contacts/imports/${encodeURIComponent(answer.importId)}`);
  }
  if (answer.status === "failed") throw new AppError("VALIDATION_ERROR", "The import could not be completed. Check the file and try again.", { field: "file" });
  return { result: answer.status === "completed" ? (answer.result ?? null) : null, pending: answer.status !== "completed" };
}

interface LaravelGroup {
  id: string;
  name: string;
  description: string | null;
  count: number;
  createdAt: string;
}

export async function listGroups() {
  const rows = await laravelData<LaravelGroup[]>("app/contact-groups");
  return rows.map((g) => ({ id: g.id, name: g.name, description: g.description, count: g.count, createdAt: date(g.createdAt) }));
}

export async function saveGroup(input: { name: string; description: string | null }, id?: string) {
  const res = id ? await laravel.put<LaravelGroup>(`app/contact-groups/${encodeURIComponent(id)}`, input) : await laravel.post<LaravelGroup>("app/contact-groups", input);
  return { id: res.data.id, name: res.data.name, description: res.data.description };
}

export async function deleteGroup(id: string) {
  await laravel.delete(`app/contact-groups/${encodeURIComponent(id)}`);
}

interface LaravelSuppression {
  id: string;
  phone: string;
  reason: SuppressionReason;
  source: string | null;
  note: string | null;
  createdAt: string;
}

export async function listSuppression(page: number, q?: string) {
  const res = await laravel.get<LaravelSuppression[]>("app/suppression", { page, q });
  return { rows: res.data.map((r) => ({ ...r, createdAt: date(r.createdAt) })), total: pageMeta(res.meta).total };
}

export async function addSuppression(input: { phone: string; reason: "OPT_OUT" | "MANUAL" | "COMPLAINT" | "INVALID"; note: string | null }) {
  const r = (await laravel.post<LaravelSuppression>("app/suppression", input)).data;
  return { ...r, createdAt: date(r.createdAt) };
}

export async function removeSuppression(id: string) {
  await laravel.delete(`app/suppression/${encodeURIComponent(id)}`);
}
