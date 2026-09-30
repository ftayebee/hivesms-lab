"use client";

import { useActionState, useState, useTransition } from "react";
import { MoreHorizontal, Plus, Star, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast, useActionFeedback } from "@/hooks/use-action-feedback";
import { requestSenderIdAction, setDefaultSenderIdAction, withdrawSenderIdAction } from "../actions";

export function RequestSenderIdDialog({ feeLabel }: { feeLabel: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Request sender ID
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">{open && <RequestForm feeLabel={feeLabel} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function RequestForm({ onDone, feeLabel }: { onDone: () => void; feeLabel: string | null }) {
  const [state, action, pending] = useActionState(requestSenderIdAction, null);
  useActionFeedback(state, onDone);
  const [type, setType] = useState(prevValue(state, "type") ?? "MASKING");
  return (
    <form action={action} noValidate encType="multipart/form-data">
      <DialogHeader>
        <DialogTitle>Request a sender ID</DialogTitle>
        <DialogDescription>Approval is decided by the upstream provider and mobile operators, and may be subject to regulatory requirements. Timelines vary and are not guaranteed.</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormStatus state={state && !state.ok ? state : null} />
        </div>
        <Field label="Type" required>
          <NativeSelect name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="MASKING">Masking (brand name)</option>
            <option value="NON_MASKING">Non-masking (number)</option>
          </NativeSelect>
        </Field>
        <Field label={type === "MASKING" ? "Brand name" : "Number"} required hint={type === "MASKING" ? "3 to 11 letters or digits, e.g. YOURBRAND" : "The number you want to send from"} error={fieldError(state, "value")}>
          <Input name="value" defaultValue={prevValue(state, "value")} maxLength={15} className="font-mono uppercase" autoFocus />
        </Field>
        <Field label="What will you send?" required error={fieldError(state, "purpose")} className="sm:col-span-2">
          <Textarea name="purpose" rows={2} defaultValue={prevValue(state, "purpose")} maxLength={500} placeholder="Order confirmations and delivery updates to our customers" />
        </Field>
        <Field label="Sample message" required error={fieldError(state, "sampleMessage")} className="sm:col-span-2">
          <Textarea name="sampleMessage" rows={2} defaultValue={prevValue(state, "sampleMessage")} maxLength={500} />
        </Field>
        <Field label="Supporting documents" required={type === "MASKING"} optional={type !== "MASKING"} hint="Trade licence, brand ownership proof or authorisation letter. PDF, PNG or JPG, up to 5 MB each, max 3 files." error={fieldError(state, "documents")} className="sm:col-span-2">
          <Input name="documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="h-auto py-1.5" />
        </Field>
        {feeLabel && (
          <Alert tone="info" className="sm:col-span-2">
            A sender ID fee of {feeLabel} applies on your plan and is charged from your wallet when the ID is approved.
          </Alert>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} loadingText="Submitting...">
          Submit request
        </Button>
      </DialogFooter>
    </form>
  );
}

export function SenderIdRowActions({ id, status, isDefault }: { id: string; status: string; isDefault: boolean }) {
  const [pending, start] = useTransition();
  if (status !== "APPROVED" && status !== "PENDING") return null;
  if (status === "APPROVED" && isDefault) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label="Sender ID actions" disabled={pending}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {status === "APPROVED" && (
          <DropdownMenuItem onSelect={() => start(async () => void (await runWithToast(() => setDefaultSenderIdAction(id))))}>
            <Star /> Make default
          </DropdownMenuItem>
        )}
        {status === "PENDING" && (
          <DropdownMenuItem destructive onSelect={() => start(async () => void (await runWithToast(() => withdrawSenderIdAction(id))))}>
            <Undo2 /> Withdraw request
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
