"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, FileText, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DatePicker, Input, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { dateToDhakaLocalInput, formatBDT, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cancelTopUpRequestAction, submitTopUpRequestAction } from "../actions";
import { METHOD_LABEL, TOPUP_BADGE, TOPUP_STATUS_LABEL, type PaymentMethod, type TopUpRequest } from "../types";

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          toast.error("Copy failed. Select the text instead.");
        }
      }}
      className="inline-grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function Detail({ k, v, copy }: { k: string; v: string | null; copy?: boolean }) {
  if (!v) return null;
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="flex items-center gap-1 text-right font-medium">
        <span className={copy ? "font-mono tabular" : undefined}>{v}</span>
        {copy && <CopyButton value={v} label={k} />}
      </dd>
    </div>
  );
}

/** Receiving accounts + request form + request history (Wallet page). Nothing here credits a wallet. */
export function ManualTopUp({ methods, requests, vatRatePercent, canManage }: { methods: PaymentMethod[]; requests: TopUpRequest[]; vatRatePercent: number; canManage: boolean }) {
  const router = useRouter();
  const [selected, setSelected] = useState(methods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [maxPaidAt] = useState(() => dateToDhakaLocalInput(new Date()));
  const formRef = useRef<HTMLFormElement>(null);
  const m = methods.find((x) => x.id === selected);
  const total = Number(amount) > 0 ? Math.round(Number(amount) * (1 + vatRatePercent / 100) * 100) / 100 : 0;

  function submit(fd: FormData) {
    fd.set("paymentMethodId", selected);
    start(async () => {
      const r = await submitTopUpRequestAction(fd);
      if (!r.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.fieldErrors ?? {})) fe[k] = v[0];
        setErrors(fe);
        toast.error(r.error);
        return;
      }
      setErrors({});
      formRef.current?.reset();
      setAmount("");
      toast.success(r.message ?? "Request submitted.");
      router.refresh();
    });
  }

  if (!methods.length) {
    return <p className="text-sm text-muted-foreground">No manual payment methods are available right now.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
        {methods.map((x) => (
          <label key={x.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", selected === x.id ? "border-primary bg-primary-soft/60" : "border-border hover:bg-muted/50")}>
            <input type="radio" name="method" className="sr-only" checked={selected === x.id} onChange={() => setSelected(x.id)} />
            <span className="font-medium">{x.displayName}</span>
            <Badge tone="neutral">{METHOD_LABEL[x.type]}</Badge>
          </label>
        ))}
      </div>

      {m && (
        <div className="grid gap-4 rounded-lg border border-border p-4 md:grid-cols-[1fr_auto]">
          <dl className="space-y-1.5">
            <Detail k={m.type === "BANK" ? "Account number" : "Number"} v={m.accountNumber} copy />
            <Detail k="Account type" v={m.accountType} />
            <Detail k="Account holder" v={m.accountName} />
            <Detail k="Bank" v={m.bankName} />
            <Detail k="Branch" v={m.branchName} />
            <Detail k="Routing number" v={m.routingNumber} copy />
            <Detail k="Limits" v={m.minAmount || m.maxAmount ? `${m.minAmount ? formatBDT(m.minAmount) : "—"} to ${m.maxAmount ? formatBDT(m.maxAmount) : "—"}` : null} />
            {m.instructions && <p className="whitespace-pre-wrap pt-2 text-sm text-muted-foreground">{m.instructions}</p>}
          </dl>
          {m.hasQr && (
            <figure className="justify-self-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element -- private, same-origin image served through the BFF */}
              <img src={`/api/v1/app/payment-methods/${m.id}/qr`} alt={`${m.displayName} QR code`} className="size-40 rounded-md border border-border object-contain" />
              <figcaption className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <QrCode className="size-3" aria-hidden /> Scan to pay
              </figcaption>
            </figure>
          )}
        </div>
      )}

      {canManage && m && (
        <form ref={formRef} action={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Top-up amount (BDT)" required error={errors.amount} hint={total ? `Pay ${formatBDT(total)} incl. ${vatRatePercent}% VAT` : `VAT ${vatRatePercent}% is added`}>
            <Input name="amount" type="number" min={1} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Transaction ID" required error={errors.transactionId} hint="From your payment receipt or SMS.">
            <Input name="transactionId" maxLength={40} required autoComplete="off" className="font-mono" />
          </Field>
          <Field label="Paid from (number/account)" required={m.requireSenderNumber} optional={!m.requireSenderNumber} error={errors.senderNumber}>
            <Input name="senderNumber" maxLength={40} inputMode="tel" required={m.requireSenderNumber} />
          </Field>
          <Field label="Payment date and time (Asia/Dhaka)" required error={errors.paidAt}>
            <DatePicker name="paidAt" max={maxPaidAt} required />
          </Field>
          <Field label="Payment screenshot or receipt" required={m.requireProof} optional={!m.requireProof} error={errors.proof} hint="JPG, PNG or PDF, up to 5 MB." className="sm:col-span-2">
            <Input name="proof" type="file" accept="image/png,image/jpeg,application/pdf" required={m.requireProof} />
          </Field>
          <Field label="Note" optional error={errors.note} className="sm:col-span-2">
            <Textarea name="note" rows={2} maxLength={500} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={pending}>
              Submit for verification
            </Button>
            <p className="mt-2 text-xs text-muted-foreground">Balance is added only after our team confirms the payment on the receiving account.</p>
          </div>
        </form>
      )}

      {requests.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Your top-up requests</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium tabular">
                    {formatBDT(r.total)} <span className="text-xs font-normal text-muted-foreground">· {r.reference}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.method} · Trx {r.transactionId} · {formatDateTime(r.submittedAt)}
                  </p>
                  {r.rejectionReason && <p className="mt-0.5 text-xs text-destructive">Reason: {r.rejectionReason}</p>}
                </div>
                {r.hasProof && (
                  <a href={`/api/v1/app/topup-requests/${r.id}/proof`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <FileText className="size-3.5" aria-hidden /> Proof
                  </a>
                )}
                <StatusBadge status={TOPUP_BADGE[r.status]} label={TOPUP_STATUS_LABEL[r.status]} />
                {canManage && r.status === "pending" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const x = await cancelTopUpRequestAction(r.id);
                        if (x.ok) {
                          toast.success("Request cancelled.");
                          router.refresh();
                        } else toast.error(x.error);
                      })
                    }
                  >
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!canManage && <Alert tone="info">Ask an owner or admin to submit top-up requests.</Alert>}
    </div>
  );
}
