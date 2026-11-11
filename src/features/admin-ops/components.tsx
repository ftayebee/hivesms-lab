"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toaster";
import { AdminActionButton } from "@/components/admin/admin-ui";
import { addCatalogAction, assignCatalogAction, saveProcessingAction, setCatalogActiveAction, syncCatalogAction, resolveMessageAction } from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(r.message ?? "Done.");
        after?.();
        router.refresh();
      } else toast.error(r.error ?? "Failed.");
    });
  return { pending, run };
}

// ─── Unconfirmed messages ───

export function ResolveMessageButtons({ id }: { id: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <AdminActionButton action={(reason) => resolveMessageAction(id, "delivered", false, reason ?? "")} label="Delivered" reason="required" reasonLabel="What did you check?" confirmTitle="Mark as delivered?" confirmDescription="The charge stays. Use this when the provider report shows the SMS was delivered." />
      <AdminActionButton action={(reason) => resolveMessageAction(id, "accepted", false, reason ?? "")} label="Accepted" reason="required" reasonLabel="What did you check?" confirmTitle="Mark as accepted by the provider?" confirmDescription="The charge stays; the status shows the provider took the message." />
      <AdminActionButton
        action={(reason) => resolveMessageAction(id, "failed", true, reason ?? "")}
        label="Failed + refund"
        variant="destructive"
        reason="required"
        reasonLabel="What did you check?"
        confirmTitle="Mark as failed and refund?"
        confirmDescription="Only when the provider confirms it did NOT send the message. The cost goes back to the customer's wallet."
      />
    </div>
  );
}

// ─── Sender catalog ───

export function CatalogToolbar({ canSync }: { canSync: boolean }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState("");
  const [type, setType] = useState<"MASKING" | "NON_MASKING">("MASKING");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Button variant="secondary" loading={pending} disabled={!canSync} onClick={() => run(() => syncCatalogAction())} title={canSync ? undefined : "The provider offers no sender ID listing API"}>
        Sync from provider
      </Button>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addCatalogAction(value.trim(), type), () => setValue(""));
        }}
      >
        <Field label="Sender ID">
          <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={20} required className="w-40" />
        </Field>
        <Field label="Type">
          <NativeSelect value={type} onChange={(e) => setType(e.target.value as "MASKING" | "NON_MASKING")}>
            <option value="MASKING">Masking</option>
            <option value="NON_MASKING">Non-masking</option>
          </NativeSelect>
        </Field>
        <Button type="submit" disabled={!value.trim() || pending}>
          Add manually
        </Button>
      </form>
    </div>
  );
}

export function CatalogAssign({ id, active, assigned, organizations }: { id: string; active: boolean; assigned: string[]; organizations: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [selected, setSelected] = useState<string[]>(assigned);
  const [filter, setFilter] = useState("");
  const shown = organizations.filter((o) => o.name.toLowerCase().includes(filter.toLowerCase())).slice(0, 50);
  const changed = selected.length !== assigned.length || selected.some((s) => !assigned.includes(s));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {selected.map((s) => (
          <Badge key={s} tone="primary">
            {organizations.find((o) => o.id === s)?.name ?? s.slice(0, 8)}
            <button type="button" className="ml-1" aria-label="Remove" onClick={() => setSelected(selected.filter((x) => x !== s))}>
              ×
            </button>
          </Badge>
        ))}
        {!selected.length && <span className="text-xs text-muted-foreground">Not assigned</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find customer…" className="h-8 w-48" aria-label="Find customer" />
        <NativeSelect
          className="h-8 w-56"
          value=""
          aria-label="Add customer"
          disabled={!active}
          onChange={(e) => e.target.value && setSelected([...new Set([...selected, e.target.value])])}
        >
          <option value="">Add customer…</option>
          {shown.filter((o) => !selected.includes(o.id)).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </NativeSelect>
        <Button size="sm" disabled={!changed || pending} loading={pending} onClick={() => run(() => assignCatalogAction(id, selected))}>
          Save
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setCatalogActiveAction(id, !active))}>
          {active ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </div>
  );
}

// ─── Campaign processing settings ───

export interface ProcessingSettings {
  campaign: {
    defaultBatchSize: number;
    allowedBatchSizes: number[];
    maxDynamicRows: number;
    maxBatchesPerTick: number;
    throttleMs: number;
    providerConcurrency: Record<string, number>;
    risk: { newAccountDays: number; newAccountMaxRecipients: number; transactionalBulkThreshold: number; holdAboveRecipients: number };
  };
  manualPayments: { proofMaxBytes: number; maxOpenRequestsPerOrganization: number; suspiciousAmount: number };
  limits: { hardMaxBatchSize: number; hardMaxConcurrency: number; hardMaxDynamicRows: number };
}

export function ProcessingForm({ value }: { value: ProcessingSettings }) {
  const { pending, run } = useRun();
  const c = value.campaign;
  const [sizes, setSizes] = useState(c.allowedBatchSizes.join(", "));
  const [def, setDef] = useState(String(c.defaultBatchSize));
  const [num, setNum] = useState<Record<string, string>>({
    maxDynamicRows: String(c.maxDynamicRows),
    maxBatchesPerTick: String(c.maxBatchesPerTick),
    throttleMs: String(c.throttleMs),
    newAccountDays: String(c.risk.newAccountDays),
    newAccountMaxRecipients: String(c.risk.newAccountMaxRecipients),
    transactionalBulkThreshold: String(c.risk.transactionalBulkThreshold),
    holdAboveRecipients: String(c.risk.holdAboveRecipients),
    proofMaxMb: String(Math.round((value.manualPayments.proofMaxBytes / 1048576) * 10) / 10),
    maxOpen: String(value.manualPayments.maxOpenRequestsPerOrganization),
    suspiciousAmount: String(value.manualPayments.suspiciousAmount),
  });
  const [conc, setConc] = useState<Record<string, string>>(Object.fromEntries(Object.entries(c.providerConcurrency).map(([k, v]) => [k, String(v)])));
  const n = (k: string) => Number(num[k]);
  const field = (k: string, label: string, hint?: string) => (
    <Field key={k} label={label} hint={hint}>
      <Input type="number" min={0} value={num[k]} onChange={(e) => setNum({ ...num, [k]: e.target.value })} />
    </Field>
  );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        run(() =>
          saveProcessingAction({
            allowedBatchSizes: sizes.split(/[\s,]+/).filter(Boolean).map(Number),
            defaultBatchSize: Number(def),
            maxDynamicRows: n("maxDynamicRows"),
            maxBatchesPerTick: n("maxBatchesPerTick"),
            throttleMs: n("throttleMs"),
            providerConcurrency: Object.fromEntries(Object.entries(conc).map(([k, v]) => [k, Number(v)])),
            risk: { newAccountDays: n("newAccountDays"), newAccountMaxRecipients: n("newAccountMaxRecipients"), transactionalBulkThreshold: n("transactionalBulkThreshold"), holdAboveRecipients: n("holdAboveRecipients") },
            manualPayments: { proofMaxBytes: Math.round(n("proofMaxMb") * 1048576), maxOpenRequestsPerOrganization: n("maxOpen"), suspiciousAmount: n("suspiciousAmount") },
          }),
        );
      }}
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <Field label="Permitted batch sizes" hint={`Comma-separated, each 1–${value.limits.hardMaxBatchSize}. Customers choose only from these.`}>
          <Input value={sizes} onChange={(e) => setSizes(e.target.value)} />
        </Field>
        <Field label="Default batch size">
          <Input type="number" value={def} onChange={(e) => setDef(e.target.value)} />
        </Field>
        {field("maxDynamicRows", "Max Dynamic SMS rows", `Hard limit ${value.limits.hardMaxDynamicRows.toLocaleString()}.`)}
        {field("maxBatchesPerTick", "Batches per worker run", "Across all campaigns, per minute.")}
        {field("throttleMs", "Pause between provider calls (ms)", "0–5000.")}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Provider concurrency</h3>
        <p className="mb-3 text-xs text-muted-foreground">Messages sent per provider round trip, capped at {value.limits.hardMaxConcurrency}. Batch size never overrides this.</p>
        <div className="grid gap-4 sm:grid-cols-4">
          {Object.entries(conc).map(([k, v]) => (
            <Field key={k} label={k}>
              <Input type="number" min={1} max={value.limits.hardMaxConcurrency} value={v} onChange={(e) => setConc({ ...conc, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Campaign risk thresholds</h3>
        <p className="mb-3 text-xs text-muted-foreground">Campaigns matching a rule wait for a staff check. Routine campaigns are queued automatically.</p>
        <div className="grid gap-4 sm:grid-cols-4">
          {field("newAccountDays", "New account (days)")}
          {field("newAccountMaxRecipients", "New account max recipients")}
          {field("transactionalBulkThreshold", "Transactional bulk threshold", "0 = off")}
          {field("holdAboveRecipients", "Hold above recipients", "0 = off (recommended)")}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Manual payments</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {field("proofMaxMb", "Proof file limit (MB)", "0.1–10")}
          {field("maxOpen", "Open requests per customer")}
          {field("suspiciousAmount", "Flag requests from (BDT)")}
        </div>
      </section>
      <Button type="submit" loading={pending}>
        Save settings
      </Button>
    </form>
  );
}
