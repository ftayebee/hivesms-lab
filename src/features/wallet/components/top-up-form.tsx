"use client";

import { useActionState, useMemo, useState } from "react";
import { CreditCard, Landmark, FlaskConical, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { FormStatus, fieldError } from "@/components/shared/form-status";
import { topUpBreakdown } from "@/lib/pricing";
import { formatBDT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { startCheckoutAction } from "../actions";

export interface TopUpFormProps {
  packages: { id: string; name: string; amount: number; bonusPercent: number }[];
  providers: { key: string; name: string; description: string; verified: boolean }[];
  vatRatePercent: number;
  minimum: number;
  maximum: number;
}

const ICONS: Record<string, typeof CreditCard> = { mock: FlaskConical, manual: Landmark, sslcommerz: CreditCard };

export function TopUpForm({ packages, providers, vatRatePercent, minimum, maximum }: TopUpFormProps) {
  const [state, action, pending] = useActionState(startCheckoutAction, null);
  const [packageId, setPackageId] = useState<string>(packages[1]?.id ?? packages[0]?.id ?? "custom");
  const [custom, setCustom] = useState<string>(String(minimum));
  const [provider, setProvider] = useState(providers[0]?.key ?? "");
  const pkg = packages.find((p) => p.id === packageId);
  const amount = pkg ? pkg.amount : Number(custom) || 0;
  const breakdown = useMemo(() => topUpBreakdown(amount, vatRatePercent, pkg?.bonusPercent ?? 0), [amount, vatRatePercent, pkg]);
  const customInvalid = !pkg && (amount < minimum || amount > maximum);

  if (!providers.length) {
    return <Alert tone="warning" title="No payment method is available">Online top-ups are not configured yet. Contact support to add balance.</Alert>;
  }

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_18rem]" noValidate>
      <div className="space-y-6">
        <FormStatus state={state} />
        <fieldset>
          <legend className="mb-3 text-sm font-medium">1. Choose an amount</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {packages.map((p) => (
              <label key={p.id} className={cn("relative cursor-pointer rounded-lg border p-3 transition-colors", packageId === p.id ? "border-primary bg-primary-soft/60 ring-1 ring-primary" : "border-border hover:bg-muted/50")}>
                <input type="radio" name="packageId" value={p.id} checked={packageId === p.id} onChange={() => setPackageId(p.id)} className="sr-only" />
                <span className="block text-sm font-semibold tabular">{formatBDT(p.amount, "en", { decimals: 0 })}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{p.bonusPercent > 0 ? `+${p.bonusPercent}% bonus credit` : "No bonus"}</span>
              </label>
            ))}
            <label className={cn("cursor-pointer rounded-lg border p-3", packageId === "custom" ? "border-primary bg-primary-soft/60 ring-1 ring-primary" : "border-border hover:bg-muted/50")}>
              <input type="radio" name="packageChoice" checked={packageId === "custom"} onChange={() => setPackageId("custom")} className="sr-only" />
              <span className="block text-sm font-semibold">Custom</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Any amount</span>
            </label>
          </div>
          {packageId === "custom" && (
            <Field label="Amount (BDT, before VAT)" required hint={`Between ${formatBDT(minimum, "en", { decimals: 0 })} and ${formatBDT(maximum, "en", { decimals: 0 })}`} error={customInvalid && custom ? "Enter an amount within the allowed range." : fieldError(state, "amount")} className="mt-4 max-w-xs">
              <Input name="amount" type="number" inputMode="decimal" min={minimum} max={maximum} step="1" value={custom} onChange={(e) => setCustom(e.target.value)} />
            </Field>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-medium">2. Payment method</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {providers.map((p) => {
              const Icon = ICONS[p.key] ?? CreditCard;
              return (
                <label key={p.key} className={cn("flex cursor-pointer gap-3 rounded-lg border p-3", provider === p.key ? "border-primary bg-primary-soft/60 ring-1 ring-primary" : "border-border hover:bg-muted/50")}>
                  <input type="radio" name="provider" value={p.key} checked={provider === p.key} onChange={() => setProvider(p.key)} className="sr-only" />
                  <Icon className={cn("mt-0.5 size-4 shrink-0", provider === p.key ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {p.name}
                      {p.key === "mock" && <Badge tone="warning">Test only</Badge>}
                      {!p.verified && <Badge tone="neutral">Unverified integration</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{p.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <aside className="h-fit rounded-lg border border-border bg-surface p-4" aria-live="polite">
        <p className="text-sm font-medium">3. Confirm</p>
        <dl className="mt-3 space-y-2 text-sm">
          {[
            ["Top-up", formatBDT(breakdown.subtotal.toString())],
            [`VAT (${vatRatePercent}%)`, formatBDT(breakdown.vatAmount.toString())],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="tabular">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <dt>You pay</dt>
            <dd className="tabular">{formatBDT(breakdown.total.toString())}</dd>
          </div>
          <div className="flex justify-between text-success">
            <dt>Added to wallet</dt>
            <dd className="font-medium tabular">{formatBDT(breakdown.creditAmount.toString())}</dd>
          </div>
        </dl>
        {breakdown.bonus.gt(0) && <p className="mt-2 text-xs text-muted-foreground">Includes {formatBDT(breakdown.bonus.toString())} bonus credit.</p>}
        <Button type="submit" size="lg" className="mt-4 w-full" loading={pending} loadingText="Starting payment..." disabled={!provider || customInvalid || amount <= 0}>
          Continue to payment
        </Button>
        <p className="mt-3 flex gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> Card and mobile-banking details are entered on the payment provider&apos;s page, never on ours.
        </p>
      </aside>
    </form>
  );
}
