"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { rateLimit, RateLimits } from "@/lib/rate-limit";
import { actionError, formToObject, type ActionResult } from "@/lib/action-result";
import { getRequestMeta } from "@/lib/auth/session";
import { sendEmail } from "@/services/email";
import { getSiteContent } from "@/services/settings";
import { normalizeBdPhone } from "@/lib/phone";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
  company: optionalText(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  phone: optionalText(30).refine((v) => !v || normalizeBdPhone(v) || /^\+?[\d\s-]{7,20}$/.test(v), "Enter a valid phone number."),
  subject: z.string().trim().min(3, "Enter a subject.").max(150),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(5000),
  website: z.string().max(0).optional(), // honeypot: must stay empty
});

async function guard(prefix: string) {
  const meta = await getRequestMeta();
  const rl = await rateLimit(`${prefix}:${meta.ip ?? "unknown"}`, RateLimits.publicFormPerIp);
  if (!rl.allowed) throw new AppError("RATE_LIMITED", "Too many submissions. Please try again in a few minutes.");
  return meta;
}

export async function submitContactRequest(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const raw = formToObject(formData);
    if (raw.website) return { ok: true, message: "Thanks, we'll be in touch." }; // silently drop bots
    const input = contactSchema.parse(raw);
    const meta = await guard("contact");
    await db.contactRequest.create({
      data: { name: input.name, company: input.company, email: input.email, phone: input.phone, subject: input.subject, message: input.message, ipAddress: meta.ip },
    });
    const { contactResolved } = await getSiteContent();
    await sendEmail({
      to: contactResolved.salesEmail,
      subject: `[Website] ${input.subject}`,
      text: `From: ${input.name} <${input.email}>\nCompany: ${input.company ?? "-"}\nPhone: ${input.phone ?? "-"}\n\n${input.message}`,
      html: `<p>From: ${escapeHtml(input.name)} &lt;${escapeHtml(input.email)}&gt;<br>Company: ${escapeHtml(input.company ?? "-")}<br>Phone: ${escapeHtml(input.phone ?? "-")}</p><p>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>`,
      tag: "contact-request",
    });
    return { ok: true, message: "Thanks for getting in touch. Our team usually replies within one working day." };
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
}

const abuseSchema = z.object({
  reporterName: optionalText(100),
  reporterEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.email("Enter a valid email address.").optional()),
  reporterPhone: optionalText(30),
  senderValue: z.string().trim().min(2, "Enter the sender name or number shown on the message.").max(30),
  messageContent: z.string().trim().min(5, "Paste the message you received.").max(2000),
  receivedAt: optionalText(40),
  description: optionalText(2000),
  website: z.string().max(0).optional(),
});

export async function submitAbuseReport(_prev: unknown, formData: FormData): Promise<ActionResult> {
  try {
    const raw = formToObject(formData);
    if (raw.website) return { ok: true, message: "Thank you. Your report was received." };
    const input = abuseSchema.parse(raw);
    const meta = await guard("abuse");
    // Case-insensitive: sender_ids.value uses the default utf8mb4_unicode_ci collation.
    const sender = await db.senderId.findFirst({ where: { value: { equals: input.senderValue } }, select: { organizationId: true } });
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : null;
    await db.abuseReport.create({
      data: {
        reporterName: input.reporterName,
        reporterEmail: input.reporterEmail,
        reporterPhone: input.reporterPhone,
        senderValue: input.senderValue,
        messageContent: input.messageContent,
        receivedAt: receivedAt && !isNaN(receivedAt.getTime()) ? receivedAt : null,
        description: input.description,
        organizationId: sender?.organizationId ?? null,
        ipAddress: meta.ip,
      },
    });
    return { ok: true, message: "Thank you. Our trust and safety team will review this report." };
  } catch (err) {
    return actionError(err, formToObject(formData));
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
