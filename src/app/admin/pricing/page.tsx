import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/states";
import { AdminForm } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { formatBDT, type MoneyLike } from "@/lib/format";
import { pricingPage } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { jsonStringArray } from "@/lib/utils";
import { saveBillingPolicyAction, savePackageAction, savePlanAction } from "@/features/admin/actions";
/** What the forms render; satisfied by Prisma rows and by the Laravel admin API mapping. */
interface PlanFormValue {
  id: string;
  key: string;
  name: string;
  description: string | null;
  minRechargeAmount: MoneyLike;
  transactionalNonMasking: MoneyLike;
  transactionalMasking: MoneyLike;
  promotionalNonMasking: MoneyLike;
  promotionalMasking: MoneyLike;
  senderIdFee: MoneyLike;
  features: unknown;
  isCustom: boolean;
  isPublic: boolean;
  isDefault: boolean;
  highlighted: boolean;
  active: boolean;
  sortOrder: number;
}

interface PackageFormValue {
  id: string;
  name: string;
  amount: MoneyLike;
  bonusPercent: MoneyLike;
  description: string | null;
  active: boolean;
  sortOrder: number;
}

export const metadata = { title: "Pricing" };

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-[var(--primary)]" />
      {label}
    </label>
  );
}

function PlanForm({ plan }: { plan?: PlanFormValue }) {
  const n = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  return (
    <AdminForm action={savePlanAction} submitLabel={plan ? "Save plan" : "Create plan"} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <Field label="Key">
        <Input name="key" defaultValue={plan?.key} placeholder="business" />
      </Field>
      <Field label="Name">
        <Input name="name" defaultValue={plan?.name} />
      </Field>
      <Field label="Minimum recharge (BDT)">
        <Input name="minRechargeAmount" type="number" step="1" defaultValue={n(plan?.minRechargeAmount)} />
      </Field>
      <Field label="Sender ID fee (BDT)">
        <Input name="senderIdFee" type="number" step="1" defaultValue={n(plan?.senderIdFee ?? 0)} />
      </Field>
      <Field label="Transactional non-masking">
        <Input name="transactionalNonMasking" type="number" step="0.0001" defaultValue={n(plan?.transactionalNonMasking)} />
      </Field>
      <Field label="Transactional masking">
        <Input name="transactionalMasking" type="number" step="0.0001" defaultValue={n(plan?.transactionalMasking)} />
      </Field>
      <Field label="Promotional non-masking">
        <Input name="promotionalNonMasking" type="number" step="0.0001" defaultValue={n(plan?.promotionalNonMasking)} />
      </Field>
      <Field label="Promotional masking">
        <Input name="promotionalMasking" type="number" step="0.0001" defaultValue={n(plan?.promotionalMasking)} />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <Input name="description" defaultValue={plan?.description ?? ""} />
      </Field>
      <Field label="Features (one per line)" className="sm:col-span-2">
        <Textarea name="features" rows={3} defaultValue={plan ? jsonStringArray(plan.features).join("\n") : undefined} />
      </Field>
      <Field label="Sort order">
        <Input name="sortOrder" type="number" defaultValue={n(plan?.sortOrder ?? 0)} />
      </Field>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-3">
        <Check name="active" label="Active" checked={plan?.active ?? true} />
        <Check name="isPublic" label="Show on pricing page" checked={plan?.isPublic ?? true} />
        <Check name="isDefault" label="Default for new accounts" checked={plan?.isDefault ?? false} />
        <Check name="highlighted" label="Highlight" checked={plan?.highlighted ?? false} />
        <Check name="isCustom" label="Custom (contact sales)" checked={plan?.isCustom ?? false} />
      </div>
      {plan && (
        <Field label="Reason for the change" required className="sm:col-span-2 lg:col-span-4" hint="Recorded with the before/after values. New rates apply to messages sent after saving by every organization on this plan; messages already sent keep the price they were charged.">
          <Input name="reason" maxLength={500} />
        </Field>
      )}
    </AdminForm>
  );
}

function PackageForm({ pkg }: { pkg?: PackageFormValue }) {
  return (
    <AdminForm action={savePackageAction} submitLabel={pkg ? "Save" : "Add package"} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      {pkg && <input type="hidden" name="id" value={pkg.id} />}
      <Field label="Name">
        <Input name="name" defaultValue={pkg?.name} />
      </Field>
      <Field label="Amount (BDT)">
        <Input name="amount" type="number" step="1" defaultValue={pkg ? String(pkg.amount) : ""} />
      </Field>
      <Field label="Bonus %">
        <Input name="bonusPercent" type="number" step="0.5" defaultValue={pkg ? String(pkg.bonusPercent) : "0"} />
      </Field>
      <Field label="Sort">
        <Input name="sortOrder" type="number" defaultValue={pkg ? String(pkg.sortOrder) : "0"} />
      </Field>
      <div className="flex items-end pb-2">
        <Check name="active" label="Active" checked={pkg?.active ?? true} />
      </div>
    </AdminForm>
  );
}

export default async function AdminPricingPage() {
  await requirePlatform("admin:pricing:manage");
  const { plans, packages, policy } = await laravelPage(() => pricingPage());
  return (
    <>
      <PageHeader title="Pricing" description="Rates are per SMS segment in BDT, excluding VAT. Every change is recorded in the audit log with before and after values." />
      <div className="space-y-6">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex-row flex-wrap items-center gap-2">
              <CardTitle>{p.name}</CardTitle>
              {p.isDefault && <Badge tone="primary">Default</Badge>}
              {!p.active && <Badge tone="neutral">Inactive</Badge>}
              {!p.isPublic && <Badge tone="outline">Hidden</Badge>}
              <span className="ml-auto text-sm text-muted-foreground">From {formatBDT(p.transactionalNonMasking.toString())} / segment</span>
            </CardHeader>
            <CardContent>
              <PlanForm plan={p} />
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>New plan</CardTitle>
          </CardHeader>
          <CardContent>
            <PlanForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top-up packages</CardTitle>
            <CardDescription>Shown in the customer wallet. Bonus credit is added on top of the amount paid.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {packages.map((p) => (
              <PackageForm key={p.id} pkg={p} />
            ))}
            <div className="border-t border-border pt-5">
              <PackageForm />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Billing policy</CardTitle>
            <CardDescription>Confirm the VAT rate and invoice requirements with your accountant.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminForm action={saveBillingPolicyAction} submitLabel="Save policy" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="VAT %">
                <Input name="vatRatePercent" type="number" step="0.5" defaultValue={policy.vatRatePercent} />
              </Field>
              <Field label="Minimum top-up (BDT)">
                <Input name="minimumTopUp" type="number" defaultValue={policy.minimumTopUp} />
              </Field>
              <Field label="Maximum online top-up">
                <Input name="maximumTopUp" type="number" defaultValue={policy.maximumTopUp} />
              </Field>
              <Field label="Balance validity (months, 0 = never)">
                <Input name="balanceValidityMonths" type="number" defaultValue={policy.balanceValidityMonths ?? 0} />
              </Field>
              <Field label="Invoice prefix">
                <Input name="invoicePrefix" defaultValue={policy.invoicePrefix} />
              </Field>
            </AdminForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
