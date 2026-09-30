"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { AppError } from "@/lib/errors";
import { CSV_MAX_BYTES } from "@/lib/csv";
import { contactSchema, groupSchema, suppressionSchema } from "./schemas";
import {
  addSuppression,
  bulkContacts,
  createContact,
  deleteGroup,
  importContacts,
  removeSuppression,
  saveGroup,
  updateContact,
  type BulkAction,
  type ImportResult,
} from "./service";

const done = (message: string): ActionResult => {
  revalidatePath("/dashboard/contacts", "layout");
  return { ok: true, message };
};

export async function saveContactAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "contacts:write",
    async (ctx) => {
      const input = contactSchema.parse(raw);
      const id = typeof raw.id === "string" && raw.id ? raw.id : null;
      if (id) await updateContact(ctx, id, input);
      else await createContact(ctx, input);
      return done(id ? "Contact updated." : "Contact added.");
    },
    { raw },
  );
}

const bulkSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(1000),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("delete") }),
    z.object({ type: z.literal("addToGroup"), groupId: z.uuid() }),
    z.object({ type: z.literal("removeFromGroup"), groupId: z.uuid() }),
    z.object({ type: z.literal("addTag"), tag: z.string().trim().min(1).max(40) }),
    z.object({ type: z.literal("setConsent"), consent: z.enum(["OPTED_IN", "UNKNOWN", "OPTED_OUT"]) }),
  ]),
});

export async function bulkContactsAction(ids: string[], action: BulkAction): Promise<ActionResult> {
  return tenantAction("contacts:write", async (ctx) => {
    const input = bulkSchema.parse({ ids, action });
    const n = await bulkContacts(ctx, input.ids, input.action as BulkAction);
    return done(`${n} contact${n === 1 ? "" : "s"} updated.`);
  });
}

export async function deleteContactAction(id: string): Promise<ActionResult> {
  return tenantAction("contacts:write", async (ctx) => {
    await bulkContacts(ctx, [z.uuid().parse(id)], { type: "delete" });
    return done("Contact deleted.");
  });
}

export async function importContactsAction(_prev: unknown, formData: FormData): Promise<ActionResult<ImportResult>> {
  return tenantAction<ImportResult>("contacts:write", async (ctx) => {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("VALIDATION_ERROR", "Choose a CSV file to import.", { field: "file" });
    if (file.size > CSV_MAX_BYTES) throw new AppError("VALIDATION_ERROR", "The file is larger than 10 MB. Split it into smaller files.", { field: "file" });
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv") && !name.endsWith(".txt")) {
      throw new AppError("VALIDATION_ERROR", "Upload a .csv file. To import from Excel, use File → Save As → CSV UTF-8.", { field: "file" });
    }
    const text = await file.text();
    if (text.includes("\u0000")) throw new AppError("VALIDATION_ERROR", "This does not look like a text CSV file.", { field: "file" });
    const opts = z
      .object({
        groupId: z.uuid().optional().or(z.literal("").transform(() => undefined)),
        defaultConsent: z.enum(["OPTED_IN", "UNKNOWN", "OPTED_OUT"]).default("UNKNOWN"),
        consentSource: z.string().trim().max(120).optional(),
      })
      .parse(formToObject(formData));
    const result = await importContacts(ctx, text, { groupId: opts.groupId ?? null, defaultConsent: opts.defaultConsent, consentSource: opts.consentSource || null });
    revalidatePath("/dashboard/contacts", "layout");
    return { ok: true, message: `Imported ${result.created + result.updated} contacts.`, data: result };
  });
}

export async function saveGroupAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "contacts:write",
    async (ctx) => {
      const input = groupSchema.parse(raw);
      const id = typeof raw.id === "string" && raw.id ? raw.id : undefined;
      await saveGroup(ctx, input, id);
      return done(id ? "Group updated." : "Group created.");
    },
    { raw },
  );
}

export async function deleteGroupAction(id: string): Promise<ActionResult> {
  return tenantAction("contacts:write", async (ctx) => {
    await deleteGroup(ctx, z.uuid().parse(id));
    return done("Group deleted. Its contacts were kept.");
  });
}

export async function addSuppressionAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "contacts:write",
    async (ctx) => {
      await addSuppression(ctx, suppressionSchema.parse(raw));
      return done("Number added to the suppression list.");
    },
    { raw },
  );
}

export async function removeSuppressionAction(id: string): Promise<ActionResult> {
  return tenantAction("contacts:write", async (ctx) => {
    await removeSuppression(ctx, z.uuid().parse(id));
    return done("Number removed from the suppression list.");
  });
}
