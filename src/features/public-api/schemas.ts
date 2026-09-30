import { z } from "zod";

const smsType = z
  .enum(["transactional", "promotional", "TRANSACTIONAL", "PROMOTIONAL"])
  .default("transactional")
  .transform((v) => v.toUpperCase() as "TRANSACTIONAL" | "PROMOTIONAL");

const scheduleAt = z
  .string()
  .datetime({ offset: true, message: "schedule_at must be an ISO 8601 date-time, e.g. 2026-10-01T10:00:00+06:00" })
  .optional()
  .transform((v) => (v ? new Date(v) : null));

export const sendSmsBody = z
  .object({
    to: z.string().trim().min(1, "to is required").max(32),
    message: z.string().min(1, "message is required").max(3000),
    sender_id: z.string().trim().max(20).optional(),
    type: smsType,
    reference: z.string().trim().max(100).optional(),
    schedule_at: scheduleAt,
  })
  .strict();

export const bulkSmsBody = z
  .object({
    recipients: z
      .array(
        z.union([
          z.string().trim().max(32),
          z
            .object({
              to: z.string().trim().max(32),
              message: z.string().min(1).max(3000).optional(),
              variables: z.record(z.string().max(40), z.string().max(500)).optional(),
            })
            .strict(),
        ]),
      )
      .min(1, "recipients must contain at least one entry")
      .max(1000, "recipients can contain at most 1,000 entries"),
    message: z.string().min(1, "message is required").max(3000),
    sender_id: z.string().trim().max(20).optional(),
    type: smsType,
    reference: z.string().trim().max(100).optional(),
    schedule_at: scheduleAt,
  })
  .strict();

export const estimateBody = z
  .object({
    message: z.string().min(1).max(3000),
    recipients: z.number().int().min(1).max(1_000_000).default(1),
    sender_id: z.string().trim().max(20).optional(),
    type: smsType,
  })
  .strict();

export const listMessagesQuery = z.object({
  status: z.enum(["queued", "submitted", "delivered", "failed", "rejected", "expired", "cancelled"]).optional(),
  to: z.string().trim().max(32).optional(),
  reference: z.string().trim().max(100).optional(),
  from: z.string().date().optional(),
  until: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(200).optional(),
});
