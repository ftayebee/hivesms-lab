"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { sha256 } from "@/lib/crypto";
import { laravel, laravelActionError } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { tenantAction } from "@/lib/tenant-action";
import type { DynamicEstimate, DynamicInput, DynamicPreview, DynamicUpload } from "./types";

/**
 * Dynamic SMS server actions (docs/20). Laravel only: parsing, mapping validation, rendering,
 * pricing, risk checks and the single wallet charge all happen in the API. The upload id is
 * tenant-scoped there, so an id from another organization is simply "not found".
 */

const DISABLED: ActionResult<never> = { ok: false, error: "Dynamic SMS is not enabled.", code: "FEATURE_DISABLED" };

async function call<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return laravelActionError(err);
  }
}

export async function uploadDynamicCsvAction(formData: FormData): Promise<ActionResult<DynamicUpload>> {
  if (!laravelEnabled("dynamicSms")) return DISABLED;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file.", fieldErrors: { file: ["Choose a CSV file."] } };
  return tenantAction<DynamicUpload>(["campaigns:write", "sms:send"], async () => {
    const form = new FormData();
    form.set("file", file, file.name);
    return call(async () => (await laravel.post<DynamicUpload>("app/dynamic-sms/uploads", form, { timeoutMs: 60_000 })).data);
  });
}

export async function previewDynamicAction(input: DynamicInput): Promise<ActionResult<DynamicPreview>> {
  if (!laravelEnabled("dynamicSms")) return DISABLED;
  return tenantAction<DynamicPreview>(["campaigns:write", "sms:send"], async () =>
    call(async () => (await laravel.post<DynamicPreview>("app/dynamic-sms/preview", input, { timeoutMs: 60_000 })).data),
  );
}

export async function estimateDynamicAction(input: DynamicInput): Promise<ActionResult<DynamicEstimate>> {
  if (!laravelEnabled("dynamicSms")) return DISABLED;
  return tenantAction<DynamicEstimate>(
    ["campaigns:write", "sms:send"],
    async () => call(async () => (await laravel.post<DynamicEstimate>("app/dynamic-sms/estimate", input, { timeoutMs: 60_000 })).data),
    { requireVerifiedEmail: true },
  );
}

/** Creates the campaign. The Idempotency-Key makes a double click (or a retried request) create one campaign. */
export async function submitDynamicAction(input: DynamicInput): Promise<ActionResult<{ id: string }>> {
  if (!laravelEnabled("dynamicSms")) return DISABLED;
  return tenantAction<{ id: string }>(
    ["campaigns:write", "sms:send"],
    async (ctx) => {
      const body = { ...input, confirmed: true };
      const key = `dynamic-${sha256(`${ctx.organizationId}:${ctx.userId}:${body.uploadId}:${JSON.stringify(body)}`)}`;
      try {
        const res = await laravel.post<{ id: string }>("app/dynamic-sms/submit", body, { idempotencyKey: key, timeoutMs: 120_000 });
        revalidatePath("/dashboard/campaigns");
        return { ok: true, data: { id: res.data.id }, message: (res.meta.message as string | undefined) ?? "Campaign queued." };
      } catch (err) {
        return laravelActionError(err);
      }
    },
    { requireVerifiedEmail: true },
  );
}
