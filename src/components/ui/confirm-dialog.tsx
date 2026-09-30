"use client";

import { useState, useTransition } from "react";
import { AlertDialog as A } from "radix-ui";
import { Button } from "./button";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  trigger: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Return false (or throw) to keep the dialog open. */
  onConfirm: () => Promise<unknown> | unknown;
  /** Require typing this text to enable the confirm button (for irreversible actions). */
  confirmText?: string;
}

/** Confirmation for destructive or irreversible actions. Prevents double submission. */
export function ConfirmDialog({ trigger, title, description, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive, onConfirm, confirmText }: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState("");
  const blocked = confirmText ? typed.trim() !== confirmText : false;

  return (
    <A.Root open={open} onOpenChange={(o) => (!pending ? (setOpen(o), setTyped("")) : null)}>
      <A.Trigger asChild>{trigger}</A.Trigger>
      <A.Portal>
        <A.Overlay className="fixed inset-0 z-[60] bg-[rgb(10_15_30/0.45)] data-[state=open]:animate-fade-in" />
        <A.Content className="fixed left-1/2 top-1/2 z-[70] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-lg data-[state=open]:animate-slide-in">
          <A.Title className="text-lg font-semibold tracking-tight">{title}</A.Title>
          <A.Description asChild>
            <div className="mt-2 text-sm text-muted-foreground">{description}</div>
          </A.Description>
          {confirmText && (
            <label className="mt-4 block text-sm">
              Type <span className="font-mono font-semibold">{confirmText}</span> to confirm
              <input
                className="mt-2 h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <A.Cancel asChild>
              <Button variant="secondary" disabled={pending}>
                {cancelLabel}
              </Button>
            </A.Cancel>
            <Button
              variant={destructive ? "destructive" : "primary"}
              loading={pending}
              disabled={blocked}
              className={cn(destructive && "min-w-24")}
              onClick={() =>
                start(async () => {
                  try {
                    const r = await onConfirm();
                    if (r !== false) setOpen(false);
                  } catch {
                    /* caller shows the error */
                  }
                })
              }
            >
              {confirmLabel}
            </Button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
