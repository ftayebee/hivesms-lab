"use client";

import { useActionState, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast, useActionFeedback } from "@/hooks/use-action-feedback";
import { addSuppressionAction, removeSuppressionAction } from "../actions";

export function AddSuppressionDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add number
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">{open && <AddForm onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(addSuppressionAction, null);
  useActionFeedback(state, onDone);
  return (
    <form action={action} noValidate>
      <DialogHeader>
        <DialogTitle>Suppress a number</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormStatus state={state && !state.ok ? state : null} />
        <Field label="Mobile number" required error={fieldError(state, "phone")}>
          <Input name="phone" type="tel" inputMode="tel" defaultValue={prevValue(state, "phone")} autoFocus />
        </Field>
        <Field label="Reason" required>
          <NativeSelect name="reason" defaultValue={prevValue(state, "reason") ?? "MANUAL"}>
            <option value="MANUAL">Manual</option>
            <option value="OPT_OUT">Opted out</option>
            <option value="COMPLAINT">Complaint</option>
            <option value="INVALID">Invalid number</option>
          </NativeSelect>
        </Field>
        <Field label="Note" optional>
          <Input name="note" defaultValue={prevValue(state, "note")} maxLength={300} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Suppress number
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RemoveSuppressionButton({ id, phone }: { id: string; phone: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" aria-label={`Remove ${phone} from suppression list`}>
          <X /> Remove
        </Button>
      }
      title="Remove from suppression list?"
      description="Only remove a number if the person has opted back in. Promotional messages will be sent to it again."
      confirmLabel="Remove"
      onConfirm={() => runWithToast(() => removeSuppressionAction(id))}
    />
  );
}
