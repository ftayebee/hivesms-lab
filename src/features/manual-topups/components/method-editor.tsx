"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { formatBDT } from "@/lib/format";
import { deleteMethodAction, reorderMethodsAction, saveMethodAction, uploadQrAction, type MethodForm } from "../actions";
import { METHOD_LABEL, type AdminPaymentMethod } from "../types";

const EMPTY: MethodForm = { type: "BKASH", displayName: "", accountNumber: "", requireProof: false, requireSenderNumber: true, active: true, currentPassword: "" };

function MethodDialog({ method, open, onClose }: { method: AdminPaymentMethod | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [f, setF] = useState<MethodForm>(() =>
    method
      ? {
          type: method.type, displayName: method.displayName, accountNumber: method.accountNumber, accountName: method.accountName ?? "", accountType: method.accountType ?? "",
          bankName: method.bankName ?? "", branchName: method.branchName ?? "", routingNumber: method.routingNumber ?? "", instructions: method.instructions ?? "",
          minAmount: method.minAmount ?? "", maxAmount: method.maxAmount ?? "", requireProof: method.requireProof, requireSenderNumber: method.requireSenderNumber, active: method.active, currentPassword: "",
        }
      : EMPTY,
  );
  const [qr, setQr] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof MethodForm>(k: K, v: MethodForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const bank = f.type === "BANK";

  function save() {
    start(async () => {
      const r = await saveMethodAction(method?.id ?? null, f);
      if (!r.ok) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(r.fieldErrors ?? {})) fe[k] = v[0];
        setErrors(fe);
        return void toast.error(r.error);
      }
      if (qr && r.data) {
        const fd = new FormData();
        fd.set("file", qr);
        fd.set("currentPassword", f.currentPassword);
        const q = await uploadQrAction(r.data.id, fd);
        if (!q.ok) toast.error(`Saved, but the QR image was refused: ${q.error}`);
      }
      toast.success(r.message ?? "Saved.");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{method ? `Edit ${method.displayName}` : "Add payment method"}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" required>
            <NativeSelect value={f.type} onChange={(e) => set("type", e.target.value)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Display name" required error={errors.displayName}>
            <Input value={f.displayName} onChange={(e) => set("displayName", e.target.value)} maxLength={120} placeholder="e.g. bKash Merchant" />
          </Field>
          <Field label={bank ? "Account number" : "Receiving number"} required error={errors.accountNumber} hint="Enter a verified account you control.">
            <Input value={f.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} maxLength={64} className="font-mono" />
          </Field>
          <Field label="Account holder name" required={bank} optional={!bank} error={errors.accountName}>
            <Input value={f.accountName} onChange={(e) => set("accountName", e.target.value)} maxLength={120} />
          </Field>
          <Field label="Account type" optional>
            <NativeSelect value={f.accountType ?? ""} onChange={(e) => set("accountType", e.target.value)}>
              <option value="">—</option>
              {(bank ? ["current", "savings", "other"] : ["personal", "merchant", "agent", "other"]).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {bank && (
            <>
              <Field label="Bank name" required error={errors.bankName}>
                <Input value={f.bankName} onChange={(e) => set("bankName", e.target.value)} maxLength={120} />
              </Field>
              <Field label="Branch" optional>
                <Input value={f.branchName} onChange={(e) => set("branchName", e.target.value)} maxLength={120} />
              </Field>
              <Field label="Routing number" optional error={errors.routingNumber}>
                <Input value={f.routingNumber} onChange={(e) => set("routingNumber", e.target.value)} maxLength={40} />
              </Field>
            </>
          )}
          <Field label="Minimum top-up (BDT)" optional error={errors.minAmount}>
            <Input type="number" min={1} value={f.minAmount} onChange={(e) => set("minAmount", e.target.value)} />
          </Field>
          <Field label="Maximum top-up (BDT)" optional error={errors.maxAmount}>
            <Input type="number" min={1} value={f.maxAmount} onChange={(e) => set("maxAmount", e.target.value)} />
          </Field>
          <Field label="Instructions for customers" optional className="sm:col-span-2">
            <Textarea rows={3} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} maxLength={2000} />
          </Field>
          <Field label="QR code / instruction image" optional hint="PNG or JPG, up to 5 MB." className="sm:col-span-2">
            <Input type="file" accept="image/png,image/jpeg" onChange={(e) => setQr(e.target.files?.[0] ?? null)} />
          </Field>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
            {(
              [
                ["requireProof", "Require payment proof"],
                ["requireSenderNumber", "Require sender number"],
                ["active", "Active (shown to customers)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} /> {label}
              </label>
            ))}
          </div>
          <Field label="Your current password" required error={errors.currentPassword} hint="Receiving details redirect customers' money: every change needs your password and is audited." className="sm:col-span-2">
            <PasswordInput value={f.currentPassword} onChange={(e) => set("currentPassword", e.target.value)} autoComplete="current-password" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} loading={pending} disabled={!f.currentPassword || !f.displayName || !f.accountNumber}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentMethodsManager({ methods }: { methods: AdminPaymentMethod[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminPaymentMethod | null | "new">(null);
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<AdminPaymentMethod | null>(null);
  const [pw, setPw] = useState("");

  function move(i: number, d: -1 | 1) {
    const ids = methods.map((m) => m.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    start(async () => {
      const r = await reorderMethodsAction(ids);
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });
  }

  return (
    <div className="space-y-4">
      <Button onClick={() => setEditing("new")}>
        <Plus /> Add payment method
      </Button>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {methods.map((m, i) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <div className="flex flex-col">
              <button type="button" aria-label="Move up" disabled={i === 0 || pending} onClick={() => move(i, -1)} className="text-muted-foreground disabled:opacity-30">
                <ArrowUp className="size-3.5" />
              </button>
              <button type="button" aria-label="Move down" disabled={i === methods.length - 1 || pending} onClick={() => move(i, 1)} className="text-muted-foreground disabled:opacity-30">
                <ArrowDown className="size-3.5" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {m.displayName} <Badge tone="neutral">{METHOD_LABEL[m.type]}</Badge> {!m.active && <Badge tone="warning">inactive</Badge>} {m.hasQr && <Badge tone="primary">QR</Badge>}
              </p>
              <p className="font-mono text-xs text-muted-foreground">
                {m.accountNumber}
                {m.accountName ? ` · ${m.accountName}` : ""}
                {m.bankName ? ` · ${m.bankName}` : ""}
                {m.minAmount || m.maxAmount ? ` · ${m.minAmount ? formatBDT(m.minAmount) : "—"}–${m.maxAmount ? formatBDT(m.maxAmount) : "—"}` : ""}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>
              <Pencil /> Edit
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleting(m)}>
              Remove
            </Button>
          </li>
        ))}
        {!methods.length && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No payment methods yet.</li>}
      </ul>
      {editing !== null && <MethodDialog key={editing === "new" ? "new" : editing.id} method={editing === "new" ? null : editing} open onClose={() => setEditing(null)} />}
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove {deleting?.displayName}?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="mb-3 text-sm text-muted-foreground">Customers stop seeing it. Existing requests keep their history.</p>
            <Field label="Your current password" required>
              <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              disabled={!pw}
              onClick={() =>
                start(async () => {
                  const r = await deleteMethodAction(deleting!.id, pw);
                  setPw("");
                  if (r.ok) {
                    toast.success("Removed.");
                    setDeleting(null);
                    router.refresh();
                  } else toast.error(r.error);
                })
              }
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
