import "server-only";
import type { z } from "zod";
import type { SenderIdStatus, SenderType } from "@/generated/prisma/enums";
import { laravel } from "@/lib/laravel-api";
import { date, dec } from "@/lib/laravel/convert";
import type { StoredFile } from "@/services/storage";
import type { senderIdRequestSchema } from "./service";

/**
 * Sender IDs through the Laravel API (LARAVEL_FEATURES `senderIds`). Documents are stored by Laravel
 * (backend storage, same key layout as the Node storage) and downloaded through the tenant-checked
 * document endpoint; their storage keys never reach the browser.
 */

interface LaravelSenderId {
  id: string;
  value: string;
  type: SenderType;
  status: SenderIdStatus;
  purpose: string | null;
  sampleMessage: string | null;
  documents?: Array<{ index: number; name: string; size: number | null; contentType: string | null }>;
  rejectionReason: string | null;
  isDefault: boolean;
  reviewedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toSenderId(s: LaravelSenderId) {
  // The page renders `documents` as StoredFile[] (name + a React key); the key here is only a label.
  const documents: StoredFile[] = (s.documents ?? []).map((d) => ({ key: `document-${d.index}`, name: d.name, size: d.size ?? 0, contentType: d.contentType ?? "application/octet-stream" }));
  return {
    id: s.id,
    value: s.value,
    type: s.type,
    status: s.status,
    purpose: s.purpose,
    sampleMessage: s.sampleMessage,
    documents,
    rejectionReason: s.rejectionReason,
    isDefault: s.isDefault,
    reviewedAt: date(s.reviewedAt),
    approvedAt: date(s.approvedAt),
    createdAt: date(s.createdAt),
    updatedAt: date(s.updatedAt),
  };
}

/** List plus the plan's sender-ID fee (returned by the same Laravel call). */
export async function listSenderIds() {
  const res = await laravel.get<LaravelSenderId[]>("app/sender-ids");
  return { senders: res.data.map(toSenderId), senderIdFee: dec(res.meta.senderIdFee as string | undefined) };
}

export async function approvedSenderIds() {
  const res = await laravel.get<LaravelSenderId[]>("app/sender-ids/approved");
  return res.data.map((s) => ({ id: s.id, value: s.value, type: s.type, isDefault: s.isDefault }));
}

/** Multipart: the original files go to Laravel, which validates size, type, extension and magic bytes. */
export async function requestSenderId(input: z.infer<typeof senderIdRequestSchema>, files: File[]) {
  const form = new FormData();
  form.set("value", input.value);
  form.set("type", input.type);
  form.set("purpose", input.purpose);
  form.set("sampleMessage", input.sampleMessage);
  for (const f of files.filter((f) => f.size > 0)) form.append("documents[]", f, f.name);
  return toSenderId((await laravel.post<LaravelSenderId>("app/sender-ids", form, { timeoutMs: 60_000 })).data);
}

export async function setDefaultSenderId(id: string) {
  await laravel.put(`app/sender-ids/${encodeURIComponent(id)}`, { isDefault: true });
}

export async function withdrawSenderIdRequest(id: string) {
  await laravel.delete(`app/sender-ids/${encodeURIComponent(id)}`);
}
