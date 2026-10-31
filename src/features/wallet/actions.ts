"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { AppError } from "@/lib/errors";
import { completePayment, failPayment } from "@/services/billing/payments";
import { cancelPendingPayment, createTopUp, getOwnPayment, previewTopUp, submitManualReference, topUpSchema, updateLowBalanceThreshold } from "./service";
import { laravelEnabled } from "@/lib/laravel/flags";
import * as viaLaravel from "./laravel";

export interface TopUpPreview {
  subtotal: string;
  vatRate: string;
  vatAmount: string;
  total: string;
  bonus: string;
  creditAmount: string;
  label: string;
}

export async function previewTopUpAction(input: { packageId?: string; amount?: number }): Promise<ActionResult<TopUpPreview>> {
  return tenantAction<TopUpPreview>("billing:read", async () => {
    const b = await previewTopUp(input);
    return {
      ok: true,
      data: {
        subtotal: b.subtotal.toFixed(2),
        vatRate: b.vatRate.toString(),
        vatAmount: b.vatAmount.toFixed(2),
        total: b.total.toFixed(2),
        bonus: b.bonus.toFixed(2),
        creditAmount: b.creditAmount.toFixed(2),
        label: b.label,
      },
    };
  });
}

export async function startCheckoutAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  let target = "";
  const r = await tenantAction(
    "billing:manage",
    async (ctx, session) => {
      const input = topUpSchema.parse(raw);
      const { payment, result } = await createTopUp(ctx, input, { name: session.user.name, email: session.user.email, phone: session.user.phone });
      target = result.type === "redirect" ? result.url : `/dashboard/wallet/payments/${payment.id}`;
    },
    { raw },
  );
  if (!r.ok) return r;
  redirect(target);
}

export async function submitReferenceAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "billing:manage",
    async (ctx) => {
      const { id, reference } = z
        .object({ id: z.uuid(), reference: z.string().trim().min(4, "Enter the transaction or deposit reference.").max(100) })
        .parse(raw);
      await submitManualReference(ctx, id, reference);
      revalidatePath(`/dashboard/wallet/payments/${id}`);
      return { ok: true, message: "Reference submitted. We'll add the balance after verifying the payment." };
    },
    { raw },
  );
}

export async function cancelPaymentAction(id: string): Promise<ActionResult> {
  return tenantAction("billing:manage", async (ctx) => {
    await cancelPendingPayment(ctx, z.uuid().parse(id));
    revalidatePath("/dashboard/wallet");
    return { ok: true, message: "Payment cancelled." };
  });
}

export async function updateThresholdAction(_prev: unknown, formData: FormData): Promise<ActionResult> {
  const raw = formToObject(formData);
  return tenantAction(
    "billing:manage",
    async (ctx) => {
      const { threshold } = z.object({ threshold: z.coerce.number().min(0, "Must be zero or more.").max(1_000_000) }).parse(raw);
      await updateLowBalanceThreshold(ctx, threshold);
      revalidatePath("/dashboard/wallet");
      return { ok: true, message: "Alert threshold saved." };
    },
    { raw },
  );
}

/**
 * Development-only simulated gateway. Refuses to run unless the payment belongs to the caller's
 * organization, uses the mock provider, and mock payments are allowed in this environment.
 */
export async function mockCheckoutAction(paymentId: string, outcome: "success" | "fail" | "cancel") {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_PAYMENTS !== "true") throw new AppError("FORBIDDEN", "Mock payments are disabled.");
  const r = await tenantAction("billing:manage", async (ctx) => {
    if (laravelEnabled("payments")) {
      // Laravel refuses unless mock payments are allowed there and the payment is this tenant's mock payment.
      await viaLaravel.mockComplete(z.uuid().parse(paymentId), outcome);
      return;
    }
    const p = await getOwnPayment(ctx, z.uuid().parse(paymentId));
    if (p.provider !== "mock") throw new AppError("FORBIDDEN", "Not a test payment.");
    if (outcome === "success") {
      await completePayment(p.id, { providerRef: `MOCK-${Date.now()}`, confirmedAmount: p.total.toFixed(2), actor: { type: "SYSTEM" }, note: "mock gateway" });
    } else {
      await failPayment(p.id, outcome === "cancel" ? "Cancelled at the test gateway" : "Declined at the test gateway", { type: "SYSTEM" }, outcome === "cancel" ? "CANCELLED" : "FAILED");
    }
  });
  if (!r.ok) throw new AppError("INVALID_REQUEST", r.error);
  redirect(`/dashboard/wallet/payments/${z.uuid().parse(paymentId)}`);
}
