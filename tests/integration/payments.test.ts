import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createTopUp, submitManualReference } from "@/features/wallet/service";
import { completePayment } from "@/services/billing/payments";
import { processPaymentCallback } from "@/services/payments/callbacks";
import { balanceOf, createTenant, resetDatabase } from "../support/factories";

const customer = { name: "Owner", email: "owner@example.com", phone: null };

describe("wallet top-ups", () => {
  beforeEach(resetDatabase);

  it("credits the wallet once and issues one VAT invoice, even if completion is repeated", async () => {
    const { ctx, org } = await createTenant();
    const pkg = await db.creditPackage.findFirstOrThrow({ where: { bonusPercent: 2 } }); // BDT 5,000 +2%
    const { payment, result } = await createTopUp(ctx, { provider: "mock", packageId: pkg.id }, customer);
    expect(result.type).toBe("redirect");
    expect(payment).toMatchObject({ status: "PENDING" });
    expect(Number(payment.total)).toBe(5750); // 15% VAT
    expect(Number(payment.creditAmount)).toBe(5100);

    const [a, b] = await Promise.all([
      completePayment(payment.id, { actor: { type: "SYSTEM" }, confirmedAmount: "5750.00" }),
      completePayment(payment.id, { actor: { type: "SYSTEM" }, confirmedAmount: "5750.00" }),
    ]);
    expect([a.status, b.status].sort()).toEqual(["already_completed", "completed"]);
    expect(await balanceOf(org.id)).toBe(5100);
    expect(await db.invoice.count({ where: { organizationId: org.id } })).toBe(1);
    const inv = await db.invoice.findFirstOrThrow({});
    expect(inv.number).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(Number(inv.vatAmount)).toBe(750);
  });

  it("rejects a confirmation whose amount does not match", async () => {
    const { ctx, org } = await createTenant();
    const { payment } = await createTopUp(ctx, { provider: "mock", amount: 1000 }, customer);
    await expect(completePayment(payment.id, { actor: { type: "SYSTEM" }, confirmedAmount: "1.00" })).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    expect(await balanceOf(org.id)).toBe(0);
  });

  it("enforces the minimum top-up", async () => {
    const { ctx } = await createTenant();
    await expect(createTopUp(ctx, { provider: "mock", amount: 10 }, customer)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("moves manual payments to verification when a reference is submitted", async () => {
    const { ctx } = await createTenant();
    const { payment, result } = await createTopUp(ctx, { provider: "manual", amount: 2000 }, customer);
    expect(result.type).toBe("manual");
    await submitManualReference(ctx, payment.id, "TRX-123");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("AWAITING_VERIFICATION");
  });

  it("does not let unverifiable failure callbacks change a pending payment", async () => {
    const { ctx } = await createTenant();
    const { payment } = await createTopUp(ctx, { provider: "mock", amount: 1000 }, customer);
    // The mock provider has no callback handler; the call must be a no-op.
    const r = await processPaymentCallback("mock", { query: new URLSearchParams({ tran_id: payment.id }), form: new URLSearchParams({ status: "FAILED" }), headers: new Headers() });
    expect(r.outcome).toBe("unsupported");
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });
});
