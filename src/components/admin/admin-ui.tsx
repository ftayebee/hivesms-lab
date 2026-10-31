"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { FormStatus } from "@/components/shared/form-status";
import { toast } from "@/components/ui/toaster";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import type { ActionResult } from "@/lib/action-result";

/**
 * Runs an admin action; optionally asks for a reason first (for rejections, suspensions).
 * Server actions are passed as functions from server components (bound with the target id).
 */
export function AdminActionButton({
  action,
  label,
  reason,
  reasonLabel = "Reason (shown to the customer)",
  extraField,
  password,
  confirmTitle,
  confirmDescription,
  variant = "secondary",
  size = "sm",
}: {
  action: (reason?: string, extra?: string, password?: string) => Promise<ActionResult>;
  label: string;
  reason?: "required" | "optional";
  reasonLabel?: string;
  extraField?: string;
  /** Privileged action: ask for the staff member's current password (re-authentication). */
  password?: boolean;
  confirmTitle?: string;
  confirmDescription?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [extra, setExtra] = useState("");
  const [pw, setPw] = useState("");
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await action(text || undefined, extra || undefined, password ? pw : undefined);
      setPw("");
      if (r.ok) {
        toast.success(r.message ?? "Done.");
        setOpen(false);
        setText("");
        router.refresh();
      } else toast.error(r.error);
    });
  const needsDialog = Boolean(reason || confirmTitle || password);
  return (
    <>
      <Button variant={variant} size={size} loading={pending && !open} onClick={() => (needsDialog ? setOpen(true) : run())}>
        {label}
      </Button>
      {needsDialog && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>{confirmTitle ?? label}</DialogTitle>
              {confirmDescription && <DialogDescription>{confirmDescription}</DialogDescription>}
            </DialogHeader>
            <DialogBody className="space-y-4">
              {reason && (
                <Field label={reasonLabel} required={reason === "required"}>
                  <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} autoFocus />
                </Field>
              )}
              {extraField && (
                <Field label={extraField} optional>
                  <Input value={extra} onChange={(e) => setExtra(e.target.value)} maxLength={100} />
                </Field>
              )}
              {password && (
                <Field label="Your current password" required hint="Required for privileged actions.">
                  <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" maxLength={200} />
                </Field>
              )}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant={variant === "destructive" ? "destructive" : "primary"} onClick={run} loading={pending} disabled={(reason === "required" && text.trim().length < (password ? 5 : 3)) || (password && !pw)}>
                {label}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** Select that runs an action on change (status changes). */
export function AdminStatusSelect({ value, options, action, label }: { value: string; options: { value: string; label: string }[]; action: (v: string) => Promise<ActionResult>; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <NativeSelect
      aria-label={label}
      defaultValue={value}
      disabled={pending}
      className="h-8 w-44 text-[13px]"
      onChange={(e) => {
        const v = e.target.value;
        start(async () => {
          const r = await action(v);
          if (r.ok) {
            toast.success(r.message ?? "Updated.");
            router.refresh();
          } else {
            toast.error(r.error);
            e.target.value = value;
          }
        });
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/** Generic admin form bound to a (prev, formData) server action; renders children fields. */
export function AdminForm({ action, children, submitLabel = "Save", className }: { action: (p: unknown, fd: FormData) => Promise<ActionResult>; children: React.ReactNode | ((state: ActionResult | null) => React.ReactNode); submitLabel?: string; className?: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);
  useActionFeedback(state, () => router.refresh());
  return (
    <form action={formAction} className={className ?? "space-y-4"} noValidate>
      <FormStatus state={state && !state.ok ? state : null} />
      {typeof children === "function" ? children(state) : children}
      <div>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Staff access change (platform role and/or account status) with a mandatory reason and the acting
 * super admin's current password. The server enforces every rule (no self-change, one active owner).
 */
export function AccessChangeButton({
  email,
  role,
  status,
  roles,
  action,
}: {
  email: string;
  role: string;
  status: string;
  roles: string[];
  action: (input: { platformRole?: string; status?: string }, reason?: string, password?: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [nextRole, setNextRole] = useState(role);
  const [nextStatus, setNextStatus] = useState(status);
  const [reason, setReason] = useState("");
  const [pw, setPw] = useState("");
  const [pending, start] = useTransition();
  const changed = nextRole !== role || nextStatus !== status;
  const run = () =>
    start(async () => {
      const r = await action({ ...(nextRole !== role ? { platformRole: nextRole } : {}), ...(nextStatus !== status ? { status: nextStatus } : {}) }, reason, pw);
      setPw("");
      if (r.ok) {
        toast.success(r.message ?? "Updated.");
        setOpen(false);
        setReason("");
        router.refresh();
      } else toast.error(r.error);
    });
  const label = (v: string) => v.replace("_", " ").toLowerCase();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Change access
      </Button>
      <Dialog open={open} onOpenChange={(o) => (!pending ? setOpen(o) : null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Change access for {email}</DialogTitle>
            <DialogDescription>They are signed out everywhere. The change, the reason and your name are recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Platform role">
                <NativeSelect value={nextRole} onChange={(e) => setNextRole(e.target.value)}>
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {label(r)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Account">
                <NativeSelect value={nextStatus} onChange={(e) => setNextStatus(e.target.value)}>
                  <option value="ACTIVE">active</option>
                  <option value="SUSPENDED">suspended</option>
                </NativeSelect>
              </Field>
            </div>
            <Field label="Reason" required>
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
            <Field label="Your current password" required>
              <PasswordInput value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" maxLength={200} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={run} loading={pending} disabled={!changed || reason.trim().length < 5 || !pw}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
