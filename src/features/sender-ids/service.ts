import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { actorOf, assertOrgActive, requirePermission, type TenantContext } from "@/lib/auth/context";
import { getSmsProvider } from "@/services/sms";
import { getStorage, storeDocument, type StoredFile } from "@/services/storage";

export const senderIdRequestSchema = z.object({
  value: z
    .string()
    .trim()
    .min(3, "Sender IDs are at least 3 characters.")
    .max(15)
    .transform((v) => v.toUpperCase()),
  type: z.enum(["MASKING", "NON_MASKING"]),
  purpose: z.string().trim().min(10, "Describe what you will send (at least 10 characters).").max(500),
  sampleMessage: z.string().trim().min(10, "Add a sample message.").max(500),
});

export const MAX_DOCUMENTS = 3;

export async function listSenderIds(ctx: TenantContext) {
  requirePermission(ctx, "sender_ids:read");
  return db.senderId.findMany({ where: { organizationId: ctx.organizationId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
}

export async function approvedSenderIds(organizationId: string) {
  return db.senderId.findMany({ where: { organizationId, status: "APPROVED" }, orderBy: [{ isDefault: "desc" }, { value: "asc" }], select: { id: true, value: true, type: true, isDefault: true } });
}

export async function requestSenderId(ctx: TenantContext, input: z.infer<typeof senderIdRequestSchema>, files: File[]) {
  requirePermission(ctx, "sender_ids:manage");
  assertOrgActive(ctx);
  const provider = await getSmsProvider();
  const check = await provider.validateSenderId(input.value, input.type);
  if (!check.valid) throw new AppError("VALIDATION_ERROR", check.reason ?? "This sender ID format is not accepted.", { field: "value" });

  const existing = await db.senderId.findUnique({ where: { organizationId_value: { organizationId: ctx.organizationId, value: input.value } } });
  if (existing && existing.status !== "REJECTED") {
    throw new AppError("CONFLICT", existing.status === "APPROVED" ? "This sender ID is already approved for your account." : "A request for this sender ID is already in progress.", { field: "value" });
  }
  const pendingCount = await db.senderId.count({ where: { organizationId: ctx.organizationId, status: "PENDING" } });
  if (pendingCount >= 5) throw new AppError("VALIDATION_ERROR", "You can have at most 5 pending requests at a time.");

  const uploads = files.filter((f) => f.size > 0);
  if (uploads.length > MAX_DOCUMENTS) throw new AppError("VALIDATION_ERROR", `Attach at most ${MAX_DOCUMENTS} documents.`, { field: "documents" });
  if (input.type === "MASKING" && uploads.length === 0) {
    throw new AppError("VALIDATION_ERROR", "Attach at least one supporting document (for example a trade licence).", { field: "documents" });
  }
  const stored: StoredFile[] = [];
  try {
    for (const f of uploads) stored.push(await storeDocument(ctx.organizationId, f, "sender-ids"));
  } catch (err) {
    await Promise.all(stored.map((s) => getStorage().delete(s.key)));
    throw err;
  }

  const data = {
    type: input.type,
    purpose: input.purpose,
    sampleMessage: input.sampleMessage,
    documents: stored as unknown as Prisma.InputJsonValue,
    status: "PENDING" as const,
    rejectionReason: null,
    reviewedAt: null,
    reviewedById: null,
    submittedById: ctx.userId,
  };
  const sender = existing
    ? await db.senderId.update({ where: { id: existing.id }, data: { ...data, createdAt: new Date() } })
    : await db.senderId.create({ data: { ...data, organizationId: ctx.organizationId, value: input.value } });
  await audit({ action: "sender_id.request", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "sender_id", targetId: sender.id, metadata: { value: sender.value, type: sender.type, documents: stored.length } });
  return sender;
}

export async function setDefaultSenderId(ctx: TenantContext, id: string) {
  requirePermission(ctx, "sender_ids:manage");
  const s = await db.senderId.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!s) throw notFound("Sender ID");
  if (s.status !== "APPROVED") throw new AppError("VALIDATION_ERROR", "Only approved sender IDs can be the default.");
  await db.$transaction([
    db.senderId.updateMany({ where: { organizationId: ctx.organizationId }, data: { isDefault: false } }),
    db.senderId.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await audit({ action: "sender_id.set_default", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "sender_id", targetId: id });
}

export async function withdrawSenderIdRequest(ctx: TenantContext, id: string) {
  requirePermission(ctx, "sender_ids:manage");
  const s = await db.senderId.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!s) throw notFound("Sender ID");
  if (s.status !== "PENDING") throw new AppError("VALIDATION_ERROR", "Only pending requests can be withdrawn.");
  await db.senderId.delete({ where: { id } });
  for (const d of (s.documents as unknown as StoredFile[]) ?? []) await getStorage().delete(d.key).catch(() => {});
  await audit({ action: "sender_id.withdraw", actor: actorOf(ctx), organizationId: ctx.organizationId, targetType: "sender_id", targetId: id, metadata: { value: s.value } });
}

/** Document download, scoped to the tenant (or any tenant for platform staff via `organizationId: null`). */
export async function getSenderIdDocument(organizationId: string | null, senderId: string, index: number) {
  const s = await db.senderId.findFirst({ where: { id: senderId, ...(organizationId ? { organizationId } : {}) } });
  const doc = (s?.documents as unknown as StoredFile[] | undefined)?.[index];
  if (!s || !doc) throw notFound("Document");
  const file = await getStorage().get(doc.key);
  if (!file) throw notFound("Document");
  return { ...file, name: doc.name };
}
