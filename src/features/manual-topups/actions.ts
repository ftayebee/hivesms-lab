"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireAdminContext } from "@/features/admin/guard";
import type { PlatformPermission } from "@/lib/auth/permissions";
import { sha256 } from "@/lib/crypto";
import { laravel, laravelActionError } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { tenantAction } from "@/lib/tenant-action";
import type { AdminPaymentMethod, AdminTopUpRequest, TopUpRequest } from "./types";

/**
 * Manual top-ups (docs/22). Customers submit claims; only a SUPER_ADMIN credits a wallet, through
 * Laravel's PaymentService (idempotent). Every permission is enforced again by Laravel.
 */

const DISABLED: ActionResult<never> = { ok: false, error: "Manual top-ups are not enabled.", code: "FEATURE_DISABLED" };

async function call<T>(fn: () => Promise<{ data: T; meta: Record<string, unknown> }>, paths: string[] = []): Promise<ActionResult<T>> {
  try {
    const r = await fn();
    paths.forEach((p) => revalidatePath(p));
    return { ok: true, data: r.data, message: (r.meta.message as string | undefined) ?? undefined };
  } catch (err) {
    return laravelActionError(err);
  }
}

// ─── Customer ───

export async function submitTopUpRequestAction(formData: FormData): Promise<ActionResult<TopUpRequest>> {
  if (!laravelEnabled("manualTopups")) return DISABLED;
  return tenantAction<TopUpRequest>("billing:manage", async (ctx) => {
    const form = new FormData();
    for (const k of ["paymentMethodId", "amount", "transactionId", "senderNumber", "paidAt", "note"]) {
      const v = formData.get(k);
      if (typeof v === "string" && v.trim() !== "") form.set(k, v.trim());
    }
    const proof = formData.get("proof");
    if (proof instanceof File && proof.size > 0) form.set("proof", proof, proof.name);
    const key = `topup-${sha256(`${ctx.organizationId}:${form.get("paymentMethodId")}:${form.get("transactionId")}:${form.get("amount")}`)}`;
    return call(() => laravel.post<TopUpRequest>("app/topup-requests", form, { idempotencyKey: key, timeoutMs: 60_000 }), ["/dashboard/wallet"]);
  });
}

export async function cancelTopUpRequestAction(id: string): Promise<ActionResult<TopUpRequest>> {
  if (!laravelEnabled("manualTopups")) return DISABLED;
  return tenantAction<TopUpRequest>("billing:manage", async () => call(() => laravel.post<TopUpRequest>(`app/topup-requests/${encodeURIComponent(id)}/cancel`), ["/dashboard/wallet"]));
}

// ─── Staff ───

async function staff<T>(permission: PlatformPermission, fn: () => Promise<{ data: T; meta: Record<string, unknown> }>, paths: string[]): Promise<ActionResult<T>> {
  if (!laravelEnabled("manualTopups")) return DISABLED;
  try {
    await requireAdminContext(permission);
  } catch {
    return { ok: false, error: "You don't have permission to do that.", code: "FORBIDDEN" };
  }
  return call(fn, paths);
}

export interface MethodForm {
  type: string;
  displayName: string;
  accountNumber: string;
  accountName?: string;
  accountType?: string;
  bankName?: string;
  branchName?: string;
  routingNumber?: string;
  instructions?: string;
  minAmount?: string;
  maxAmount?: string;
  requireProof: boolean;
  requireSenderNumber: boolean;
  active: boolean;
  currentPassword: string;
}

function clean(f: MethodForm) {
  const out: Record<string, unknown> = { ...f };
  for (const k of ["accountName", "accountType", "bankName", "branchName", "routingNumber", "instructions", "minAmount", "maxAmount"] as const) {
    if (!f[k] || String(f[k]).trim() === "") out[k] = null;
  }
  return out;
}

export async function saveMethodAction(id: string | null, form: MethodForm): Promise<ActionResult<AdminPaymentMethod>> {
  return staff("admin:settings:manage", () => (id ? laravel.put<AdminPaymentMethod>(`admin/payment-methods/${encodeURIComponent(id)}`, clean(form)) : laravel.post<AdminPaymentMethod>("admin/payment-methods", clean(form))), ["/admin/settings/payment-methods"]);
}

export async function deleteMethodAction(id: string, currentPassword: string): Promise<ActionResult<unknown>> {
  return staff("admin:settings:manage", () => laravel.delete(`admin/payment-methods/${encodeURIComponent(id)}`, { body: { currentPassword } }), ["/admin/settings/payment-methods"]);
}

export async function reorderMethodsAction(ids: string[]): Promise<ActionResult<unknown>> {
  return staff("admin:settings:manage", () => laravel.post("admin/payment-methods/reorder", { ids }), ["/admin/settings/payment-methods"]);
}

export async function uploadQrAction(id: string, formData: FormData): Promise<ActionResult<AdminPaymentMethod>> {
  const file = formData.get("file");
  const password = formData.get("currentPassword");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a PNG or JPG image." };
  const form = new FormData();
  form.set("file", file, file.name);
  if (typeof password === "string") form.set("currentPassword", password);
  return staff("admin:settings:manage", () => laravel.post<AdminPaymentMethod>(`admin/payment-methods/${encodeURIComponent(id)}/qr`, form), ["/admin/settings/payment-methods"]);
}

export async function markUnderReviewAction(id: string): Promise<ActionResult<AdminTopUpRequest>> {
  return staff("admin:topups:review", () => laravel.post<AdminTopUpRequest>(`admin/topup-requests/${encodeURIComponent(id)}/under-review`), ["/admin/topups", `/admin/topups/${id}`]);
}

export async function addNoteAction(id: string, note: string): Promise<ActionResult<AdminTopUpRequest>> {
  return staff("admin:topups:review", () => laravel.post<AdminTopUpRequest>(`admin/topup-requests/${encodeURIComponent(id)}/notes`, { note }), [`/admin/topups/${id}`]);
}

export async function approveTopUpAction(id: string, input: { receivedAmount: string; reference: string; note?: string; currentPassword: string }): Promise<ActionResult<AdminTopUpRequest>> {
  return staff("admin:topups:approve", () => laravel.post<AdminTopUpRequest>(`admin/topup-requests/${encodeURIComponent(id)}/approve`, input, { idempotencyKey: `approve-${id}` }), ["/admin/topups", `/admin/topups/${id}`]);
}

export async function rejectTopUpAction(id: string, input: { reason: string; currentPassword: string }): Promise<ActionResult<AdminTopUpRequest>> {
  return staff("admin:topups:approve", () => laravel.post<AdminTopUpRequest>(`admin/topup-requests/${encodeURIComponent(id)}/reject`, input), ["/admin/topups", `/admin/topups/${id}`]);
}
