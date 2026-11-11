import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { adminMethods } from "@/features/manual-topups/laravel";
import { PaymentMethodsManager } from "@/features/manual-topups/components/method-editor";

export const metadata = { title: "Payment methods" };

/** Payment Receiving Details (docs/22): SUPER_ADMIN only, password-confirmed, audited. */
export default async function PaymentMethodsPage() {
  if (!laravelEnabled("manualTopups")) notFound();
  await requirePlatform("admin:settings:manage");
  const methods = await laravelPage(() => adminMethods());
  return (
    <>
      <PageHeader title="Payment receiving details" description="Accounts customers pay into for manual wallet top-ups (bKash, Nagad, Rocket, bank). Only enter accounts you have verified. Changes are audited with before/after values." />
      <Card>
        <CardContent className="pt-5">
          <PaymentMethodsManager methods={methods} />
        </CardContent>
      </Card>
    </>
  );
}
