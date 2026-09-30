"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast, useActionFeedback } from "@/hooks/use-action-feedback";
import { cancelPaymentAction, submitReferenceAction, updateThresholdAction } from "../actions";

export function ThresholdForm({ value, disabled }: { value: number; disabled?: boolean }) {
  const [state, action, pending] = useActionState(updateThresholdAction, null);
  useActionFeedback(state);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3" noValidate>
      <Field label="Low balance alert at (BDT)" error={fieldError(state, "threshold")} className="w-48">
        <Input name="threshold" type="number" min={0} step="1" defaultValue={prevValue(state, "threshold") ?? value} disabled={disabled} />
      </Field>
      <Button type="submit" variant="secondary" loading={pending} disabled={disabled}>
        Save
      </Button>
    </form>
  );
}

export function ReferenceForm({ paymentId, current }: { paymentId: string; current?: string | null }) {
  const [state, action, pending] = useActionState(submitReferenceAction, null);
  useActionFeedback(state);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormStatus state={state && !state.ok ? state : null} />
      <input type="hidden" name="id" value={paymentId} />
      <Field label="Transaction or deposit reference" required hint="From your bank receipt or mobile banking confirmation." error={fieldError(state, "reference")}>
        <Input name="reference" defaultValue={prevValue(state, "reference") ?? current ?? ""} maxLength={100} />
      </Field>
      <Button type="submit" loading={pending}>
        {current ? "Update reference" : "Submit reference"}
      </Button>
    </form>
  );
}

export function CancelPaymentButton({ id }: { id: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm" className="text-destructive">
          Cancel
        </Button>
      }
      title="Cancel this payment?"
      description="Only cancel if you have not paid. If you already paid, submit the reference instead."
      confirmLabel="Cancel payment"
      cancelLabel="Keep"
      destructive
      onConfirm={() => runWithToast(() => cancelPaymentAction(id))}
    />
  );
}
