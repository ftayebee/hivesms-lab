"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { actionError, echoValues, type ActionResult } from "@/lib/action-result";
import { requireAdminContext } from "@/features/admin/guard";
import { laravel } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";

/**
 * Admin → Customers → New customer. Laravel validates (same rules as sign-up), creates the user,
 * organization, roles and wallet in one transaction and audits it; the password is never echoed
 * back to the form.
 */
export async function createCustomerAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = Object.fromEntries(formData) as Record<string, string>;
  if (!laravelEnabled("admin")) return { ok: false, error: "Creating customers needs the admin API (LARAVEL_FEATURES admin)." };
  try {
    await requireAdminContext("admin:customers:create");
  } catch {
    return { ok: false, error: "Only super admins can create customer accounts.", code: "FORBIDDEN" };
  }
  let organizationId: string;
  try {
    const res = await laravel.post<{ organizationId: string }>("admin/customers", {
      company: raw.company ?? "",
      name: raw.name ?? "",
      email: raw.email ?? "",
      phone: raw.phone ?? "",
      password: raw.password ?? "",
      confirmPassword: raw.confirmPassword ?? "",
      pricingPlanId: raw.pricingPlanId || null,
      emailVerified: raw.emailVerified === "on",
      sendWelcome: raw.sendWelcome === "on",
    });
    organizationId = res.data.organizationId;
  } catch (err) {
    const r = actionError(err);
    return r.ok ? r : { ...r, values: echoValues({ company: raw.company, name: raw.name, email: raw.email, phone: raw.phone, pricingPlanId: raw.pricingPlanId }) };
  }
  revalidatePath("/admin/customers");
  redirect(`/admin/customers/${organizationId}?created=1`);
}
