"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireAdminContext } from "@/features/admin/guard";
import { laravel, laravelActionError } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import type { ImportPreview, ImportSummary, ReportImportRecord } from "./types";

/**
 * Report import server actions (docs/24). Laravel only: it parses and validates the CSV, prices
 * every row with the customer's plan, inserts the messages and debits the wallet in one
 * transaction. The file is sent again on import (preview stores nothing), and Laravel refuses the
 * same file twice for the same customer.
 */

const DISABLED: ActionResult<never> = { ok: false, error: "Report import is not enabled.", code: "FEATURE_DISABLED" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readForm(formData: FormData): { organizationId: string; file: File } | ActionResult<never> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const file = formData.get("file");
  if (!UUID.test(organizationId)) return { ok: false, error: "Choose the customer.", fieldErrors: { organizationId: ["Choose the customer."] } };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file.", fieldErrors: { file: ["Choose a CSV file."] } };
  return { organizationId, file };
}

async function guard(): Promise<ActionResult<never> | null> {
  if (!laravelEnabled("reportImport")) return DISABLED;
  try {
    await requireAdminContext("admin:reports:import");
    return null;
  } catch {
    return { ok: false, error: "You don't have permission to do that.", code: "FORBIDDEN" };
  }
}

export async function previewReportImportAction(formData: FormData): Promise<ActionResult<ImportPreview>> {
  const denied = await guard();
  if (denied) return denied;
  const input = readForm(formData);
  if ("ok" in input) return input;
  const form = new FormData();
  form.set("organizationId", input.organizationId);
  form.set("file", input.file, input.file.name);
  try {
    return { ok: true, data: (await laravel.post<ImportPreview>("admin/report-imports/preview", form, { timeoutMs: 120_000 })).data };
  } catch (err) {
    return laravelActionError(err);
  }
}

export async function importReportAction(formData: FormData): Promise<ActionResult<{ import: ReportImportRecord; summary: ImportSummary }>> {
  const denied = await guard();
  if (denied) return denied;
  const input = readForm(formData);
  if ("ok" in input) return input;
  const currentPassword = String(formData.get("currentPassword") ?? "");
  if (!currentPassword) return { ok: false, error: "Confirm with your current password.", fieldErrors: { currentPassword: ["Confirm with your current password."] } };
  const form = new FormData();
  form.set("organizationId", input.organizationId);
  form.set("file", input.file, input.file.name);
  form.set("chargeWallet", formData.get("chargeWallet") === "on" || formData.get("chargeWallet") === "true" ? "1" : "0");
  form.set("note", String(formData.get("note") ?? "").slice(0, 500));
  form.set("currentPassword", currentPassword);
  try {
    const res = await laravel.post<{ import: ReportImportRecord; summary: ImportSummary; message: string }>("admin/report-imports", form, { timeoutMs: 300_000 });
    revalidatePath("/admin/report-import");
    return { ok: true, data: { import: res.data.import, summary: res.data.summary }, message: res.data.message };
  } catch (err) {
    return laravelActionError(err);
  }
}
