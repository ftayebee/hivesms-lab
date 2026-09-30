import { z } from "zod";
import { normalizeBdPhone } from "@/lib/phone";

export const phoneField = z
  .string()
  .trim()
  .min(1, "Enter a mobile number.")
  .transform((v, ctx) => {
    const n = normalizeBdPhone(v);
    if (!n) {
      ctx.addIssue({ code: "custom", message: "Enter a valid Bangladesh mobile number, e.g. 01712345678." });
      return z.NEVER;
    }
    return n;
  });

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const tagsField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const list = Array.isArray(v) ? v : (v ?? "").split(",");
    return [...new Set(list.map((t) => t.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))].slice(0, 20);
  })
  .pipe(z.array(z.string().max(40, "Tags can be at most 40 characters.")));

/** Custom fields arrive as "key=value" lines from the form. */
export const customFieldsField = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const out: Record<string, string> = {};
    for (const line of (v ?? "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const idx = line.indexOf("=");
      const key = (idx >= 0 ? line.slice(0, idx) : line).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      if (!key) continue;
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
        ctx.addIssue({ code: "custom", message: `Invalid field name "${key}". Use letters, digits and underscores.` });
        return z.NEVER;
      }
      out[key] = idx >= 0 ? line.slice(idx + 1).trim().slice(0, 500) : "";
    }
    if (Object.keys(out).length > 30) {
      ctx.addIssue({ code: "custom", message: "At most 30 custom fields." });
      return z.NEVER;
    }
    return out;
  });

export const contactSchema = z.object({
  name: optionalString(120),
  phone: phoneField,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => v || null)
    .pipe(z.email("Enter a valid email address.").nullable()),
  company: optionalString(120),
  tags: tagsField,
  groupIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : v ? [v] : []))
    .pipe(z.array(z.uuid())),
  consentStatus: z.enum(["OPTED_IN", "UNKNOWN", "OPTED_OUT"]).default("UNKNOWN"),
  consentSource: optionalString(120),
  customFields: customFieldsField,
});

export type ContactInput = z.infer<typeof contactSchema>;

export const groupSchema = z.object({
  name: z.string().trim().min(1, "Enter a group name.").max(80),
  description: optionalString(300),
});

export const suppressionSchema = z.object({
  phone: phoneField,
  reason: z.enum(["OPT_OUT", "MANUAL", "COMPLAINT", "INVALID"]).default("MANUAL"),
  note: optionalString(300),
});

export const contactListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  group: z.uuid().optional().catch(undefined),
  tag: z.string().trim().max(40).optional(),
  consent: z.enum(["OPTED_IN", "UNKNOWN", "OPTED_OUT"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  sort: z.enum(["newest", "oldest", "name"]).catch("newest"),
});

export type ContactListQuery = z.infer<typeof contactListQuery>;
