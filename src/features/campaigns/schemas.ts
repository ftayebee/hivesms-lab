import { z } from "zod";

export const composerSchema = z.object({
  id: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.uuid().optional()),
  name: z.string().trim().max(120).optional().default(""),
  smsType: z.enum(["TRANSACTIONAL", "PROMOTIONAL"]),
  senderId: z.string().trim().max(20).optional().default(""),
  templateId: z
    .string()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.uuid().optional()),
  message: z.string().max(3000, "Message is too long."),
  groupIds: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (Array.isArray(v) ? v : v ? [v] : []))
    .pipe(z.array(z.uuid()).max(50)),
  numbers: z.string().max(3_000_000).optional().default(""),
  scheduleMode: z.enum(["now", "later"]).default("now"),
  scheduledAt: z.string().optional().default(""),
});

export type ComposerInput = z.infer<typeof composerSchema>;

export const campaignListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PROCESSING", "COMPLETED", "PAUSED", "CANCELLED", "FAILED"]).optional().catch(undefined),
  type: z.enum(["TRANSACTIONAL", "PROMOTIONAL"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
