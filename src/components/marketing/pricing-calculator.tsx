"use client";

import { useMemo, useState } from "react";
import { estimateMonthly, suggestPlan, type SenderTypeKey, type SmsTypeKey } from "@/lib/pricing";
import { formatBDT, formatNumber } from "@/lib/format";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import type { PublicPlan } from "@/services/billing/pricing";

export function PricingCalculator({ plans, vatRatePercent }: { plans: PublicPlan[]; vatRatePercent: number }) {
  const [volume, setVolume] = useState(10000);
  const [smsType, setSmsType] = useState<SmsTypeKey>("TRANSACTIONAL");
  const [senderType, setSenderType] = useState<SenderTypeKey>("NON_MASKING");
  const [segments, setSegments] = useState(1);
  const [country, setCountry] = useState<"BD">("BD");

  const plan = useMemo(() => suggestPlan(plans, volume, smsType, senderType) ?? plans[0], [plans, volume, smsType, senderType]);
  const result = useMemo(
    () => (plan ? estimateMonthly(plan, { monthlyVolume: volume, smsType, senderType, segmentsPerMessage: segments, country }, vatRatePercent) : null),
    [plan, volume, smsType, senderType, segments, country, vatRatePercent],
  );

  return (
    <div className="grid overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-[1.2fr_1fr]">
      <form className="grid gap-5 p-6 sm:grid-cols-2 md:p-8" onSubmit={(e) => e.preventDefault()} aria-label="Pricing calculator">
        <Field label="Monthly SMS volume" hint="Number of messages you send per month." className="sm:col-span-2">
          <Input type="number" inputMode="numeric" min={0} max={10_000_000} step={500} value={volume} onChange={(e) => setVolume(Math.max(0, Math.min(10_000_000, Number(e.target.value) || 0)))} />
        </Field>
        <Field label="SMS type">
          <NativeSelect value={smsType} onChange={(e) => setSmsType(e.target.value as SmsTypeKey)}>
            <option value="TRANSACTIONAL">Transactional (OTP, alerts)</option>
            <option value="PROMOTIONAL">Promotional (offers)</option>
          </NativeSelect>
        </Field>
        <Field label="Sender type">
          <NativeSelect value={senderType} onChange={(e) => setSenderType(e.target.value as SenderTypeKey)}>
            <option value="NON_MASKING">Non-masking (number)</option>
            <option value="MASKING">Masking (brand name)</option>
          </NativeSelect>
        </Field>
        <Field label="Segments per message" hint="1 for short English; Bangla over 70 characters needs 2+.">
          <NativeSelect value={segments} onChange={(e) => setSegments(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Country" hint="Only Bangladeshi numbers are supported.">
          <NativeSelect value={country} onChange={(e) => setCountry(e.target.value as "BD")}>
            <option value="BD">Bangladesh (+880)</option>
          </NativeSelect>
        </Field>
      </form>
      <div className="flex flex-col justify-between border-t border-border bg-surface p-6 md:p-8 lg:border-l lg:border-t-0" aria-live="polite">
        {result && plan ? (
          <>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Estimated monthly cost</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight tabular">{formatBDT(result.totalWithVat.toString())}</p>
              <p className="mt-1 text-sm text-muted-foreground">including {vatRatePercent}% VAT</p>
              <dl className="mt-6 space-y-2.5 text-sm">
                {[
                  ["Suggested plan", plan.name],
                  ["Rate per segment", formatBDT(result.rate.toString())],
                  ["Billable segments", formatNumber(result.segmentsTotal)],
                  ["SMS cost (excl. VAT)", formatBDT(result.smsCost.toString())],
                  ["VAT", formatBDT(result.vatAmount.toString())],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-border pb-2.5 last:border-0">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium tabular">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              This is an estimate. Your actual cost depends on the exact messages you send, failed-message refunds and the rates on your account at the time of sending.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Pricing is not configured yet.</p>
        )}
      </div>
    </div>
  );
}
