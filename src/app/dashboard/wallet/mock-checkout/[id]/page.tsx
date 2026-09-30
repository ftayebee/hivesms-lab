import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { formatBDT } from "@/lib/format";
import { getOwnPayment } from "@/features/wallet/service";
import { mockCheckoutAction } from "@/features/wallet/actions";

export const metadata = { title: "Test payment" };

/** Simulated payment gateway for development. Not available in production. */
export default async function MockCheckoutPage({ params }: PageProps<"/dashboard/wallet/mock-checkout/[id]">) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_MOCK_PAYMENTS !== "true") notFound();
  const { id } = await params;
  const { ctx, allowed } = await tenantWithPermission("billing:manage");
  if (!allowed) return <PermissionDenied permission="billing:manage" />;
  const p = await getOwnPayment(ctx, id).catch(() => null);
  if (!p || p.provider !== "mock") notFound();
  const act = (outcome: "success" | "fail" | "cancel") => async () => {
    "use server";
    await mockCheckoutAction(id, outcome);
  };
  return (
    <>
      <PageHeader title="Test payment gateway" />
      <Card className="max-w-lg">
        <CardContent className="space-y-5 pt-6">
          <Alert tone="warning" title="Simulation: no money is charged">
            This page stands in for a real payment provider during development. Choose an outcome to test the flow.
          </Alert>
          <div className="flex items-center gap-3">
            <FlaskConical className="size-8 text-warning" aria-hidden />
            <div>
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-2xl font-semibold tabular">{formatBDT(p.total.toString())}</p>
            </div>
          </div>
          {p.status !== "PENDING" ? (
            <p className="text-sm">This payment is already {p.status.toLowerCase()}.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <form action={act("success")}>
                <Button type="submit">Simulate successful payment</Button>
              </form>
              <form action={act("fail")}>
                <Button type="submit" variant="secondary">
                  Simulate failure
                </Button>
              </form>
              <form action={act("cancel")}>
                <Button type="submit" variant="ghost">
                  Cancel
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
