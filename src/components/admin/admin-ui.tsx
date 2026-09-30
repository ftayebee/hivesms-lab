"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
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
  confirmTitle,
  confirmDescription,
  variant = "secondary",
  size = "sm",
}: {
  action: (reason?: string, extra?: string) => Promise<ActionResult>;
  label: string;
  reason?: "required" | "optional";
  reasonLabel?: string;
  extraField?: string;
  confirmTitle?: string;
  confirmDescription?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [extra, setExtra] = useState("");
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await action(text || undefined, extra || undefined);
      if (r.ok) {
        toast.success(r.message ?? "Done.");
        setOpen(false);
        setText("");
        router.refresh();
      } else toast.error(r.error);
    });
  const needsDialog = Boolean(reason || confirmTitle);
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
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant={variant === "destructive" ? "destructive" : "primary"} onClick={run} loading={pending} disabled={reason === "required" && text.trim().length < 3}>
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
