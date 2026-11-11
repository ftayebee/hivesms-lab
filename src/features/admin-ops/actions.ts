"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import type { PlatformPermission } from "@/lib/auth/permissions";
import { requireAdminContext } from "@/features/admin/guard";
import { laravel, laravelActionError } from "@/lib/laravel-api";

/** Staff actions for unconfirmed messages, the sender catalog and campaign-processing settings (Laravel enforces again). */
async function run(permission: PlatformPermission, fn: () => Promise<{ meta: Record<string, unknown> }>, path: string, message: string): Promise<ActionResult> {
  try {
    await requireAdminContext(permission);
  } catch {
    return { ok: false, error: "You don't have permission to do that.", code: "FORBIDDEN" };
  }
  try {
    await fn();
    revalidatePath(path);
    return { ok: true, message };
  } catch (err) {
    return laravelActionError(err);
  }
}

export async function resolveMessageAction(id: string, outcome: "delivered" | "accepted" | "failed", refund: boolean, reason: string): Promise<ActionResult> {
  return run("admin:messages:resolve", () => laravel.post(`admin/messages/${encodeURIComponent(id)}/resolve`, { outcome, refund, reason }), "/admin/unconfirmed", "Message resolved.");
}

export async function syncCatalogAction(): Promise<ActionResult> {
  return run("admin:sender_catalog:manage", () => laravel.post("admin/sender-catalog/sync"), "/admin/sender-catalog", "Sender IDs synced from the provider.");
}

export async function addCatalogAction(value: string, type: "MASKING" | "NON_MASKING", note?: string): Promise<ActionResult> {
  return run("admin:sender_catalog:manage", () => laravel.post("admin/sender-catalog", { value, type, note: note || null }), "/admin/sender-catalog", "Sender ID added to the catalog.");
}

export async function setCatalogActiveAction(id: string, active: boolean): Promise<ActionResult> {
  return run("admin:sender_catalog:manage", () => laravel.put(`admin/sender-catalog/${encodeURIComponent(id)}`, { active }), "/admin/sender-catalog", active ? "Activated." : "Deactivated.");
}

export async function assignCatalogAction(id: string, organizationIds: string[]): Promise<ActionResult> {
  return run("admin:sender_catalog:manage", () => laravel.put(`admin/sender-catalog/${encodeURIComponent(id)}/assignments`, { organizationIds }), "/admin/sender-catalog", "Assignments saved.");
}

export async function saveProcessingAction(body: Record<string, unknown>): Promise<ActionResult> {
  return run("admin:settings:manage", () => laravel.put("admin/settings/campaign-processing", body), "/admin/processing", "Settings saved.");
}
