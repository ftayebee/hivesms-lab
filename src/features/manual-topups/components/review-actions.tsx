"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "@/components/ui/toaster";
import { AdminActionButton } from "@/components/admin/admin-ui";
import { formatBDT, formatDateTime } from "@/lib/format";
import { addNoteAction, approveTopUpAction, markUnderReviewAction, rejectTopUpAction } from "../actions";

/**
 * Staff review panel. Approval requires re-typing the amount actually received and the
 * transaction id seen on the receiving account, plus the reviewer's password; Laravel credits the
 * wallet once (a second approval is refused).
 */
export function TopUpReviewActions({ id, open, pending, total, canApprove, notes }: { id: string; open: boolean; pending: boolean; total: string; canApprove: boolean; notes: Array<{ at: string; note: string }> }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [internal, setInternal] = useState("");

  const done = (r: { ok: boolean; error?: string; message?: string }) => {
    if (r.ok) {
      toast.success(r.message ?? "Done.");
      router.refresh();
    } else toast.error(r.error ?? "Failed.");
  };

  return (
    <div className="space-y-6">
      {open && (
        <Card>
          <CardHeader>
            <CardTitle>Decision</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {pending && (
              <Button variant="secondary" className="w-full" loading={busy} onClick={() => start(async () => done(await markUnderReviewAction(id)))}>
                Mark under review
              </Button>
            )}
            {canApprove ? (
              <>
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    start(async () => {
                      const r = await approveTopUpAction(id, { receivedAmount: received, reference, note: note || undefined, currentPassword: password });
                      setPassword("");
                      done(r);
                    });
                  }}
                >
                  <Field label="Amount received (BDT)" required hint={`Must equal ${formatBDT(total)}.`}>
                    <Input inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} required />
                  </Field>
                  <Field label="Transaction ID on the receiving account" required>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} className="font-mono" required />
                  </Field>
                  <Field label="Note" optional>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                  </Field>
                  <Field label="Your current password" required>
                    <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                  </Field>
                  <Button type="submit" className="w-full" loading={busy} disabled={!received || !reference || !password}>
                    Approve and credit wallet
                  </Button>
                </form>
                <AdminActionButton
                  action={async (reason, _extra, pw) => {
                    const r = await rejectTopUpAction(id, { reason: reason ?? "", currentPassword: pw ?? "" });
                    return r.ok ? { ok: true as const, message: r.message } : r;
                  }}
                  label="Reject"
                  variant="destructive"
                  size="md"
                  reason="required"
                  password
                  confirmTitle="Reject this request?"
                  confirmDescription="Nothing is credited. The customer sees the reason."
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Only a Super Admin can approve or reject. Add your findings as a note.</p>
            )}
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Internal notes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {notes.length ? (
            <ul className="space-y-2 text-sm">
              {notes.map((n, i) => (
                <li key={i} className="rounded-md bg-surface p-2">
                  <p className="whitespace-pre-wrap">{n.note}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(n.at)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet. Customers never see these.</p>
          )}
          <Textarea rows={2} value={internal} onChange={(e) => setInternal(e.target.value)} maxLength={1000} aria-label="New note" />
          <Button
            variant="secondary"
            size="sm"
            disabled={!internal.trim() || busy}
            onClick={() =>
              start(async () => {
                const r = await addNoteAction(id, internal.trim());
                if (r.ok) setInternal("");
                done(r);
              })
            }
          >
            Add note
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
