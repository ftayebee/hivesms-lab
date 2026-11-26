import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { plansForControls } from "@/features/admin/page-data";
import { CreateCustomerForm } from "@/features/admin/components/create-customer-form";

export const metadata = { title: "New customer" };

/** Super admin: open a customer account with a password (no self-registration needed). */
export default async function NewCustomerPage() {
  if (!laravelEnabled("admin")) notFound();
  await requirePlatform("admin:customers:create");
  const plans = await laravelPage(() => plansForControls(true));

  return (
    <>
      <Link href="/admin/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Customers
      </Link>
      <PageHeader
        title="New customer"
        description="Creates the customer's organization, owner account and wallet. They sign in with this email (or mobile number) and the password you set."
      />
      <Card>
        <CardContent className="pt-6">
          <CreateCustomerForm plans={plans} />
        </CardContent>
      </Card>
    </>
  );
}
