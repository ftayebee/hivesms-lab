"use client";

import { useActionState, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast, useActionFeedback } from "@/hooks/use-action-feedback";
import { closeTicketAction, createTicketAction, replyTicketAction } from "../actions";

export function NewTicketDialog({ categories }: { categories: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createTicketAction, null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New ticket
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <form action={action} noValidate>
          <DialogHeader>
            <DialogTitle>Contact support</DialogTitle>
            <DialogDescription>Include campaign names, message IDs or request IDs if relevant. Never share passwords or full API keys.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormStatus state={state} />
            </div>
            <Field label="Subject" required error={fieldError(state, "subject")} className="sm:col-span-2">
              <Input name="subject" defaultValue={prevValue(state, "subject")} maxLength={150} autoFocus />
            </Field>
            <Field label="Category" required>
              <NativeSelect name="category" defaultValue={prevValue(state, "category") ?? "General"}>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Priority" required hint="Urgent: sending is completely blocked.">
              <NativeSelect name="priority" defaultValue={prevValue(state, "priority") ?? "NORMAL"}>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </NativeSelect>
            </Field>
            <Field label="Message" required error={fieldError(state, "message")} className="sm:col-span-2">
              <Textarea name="message" rows={6} defaultValue={prevValue(state, "message")} maxLength={10_000} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Submit ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReplyForm({ ticketId, label = "Reply" }: { ticketId: string; label?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(replyTicketAction, null);
  useActionFeedback(state, () => formRef.current?.reset());
  return (
    <form ref={formRef} action={action} className="space-y-3" noValidate>
      <FormStatus state={state && !state.ok ? state : null} />
      <input type="hidden" name="id" value={ticketId} />
      <Field label={label} error={fieldError(state, "body")}>
        <Textarea name="body" rows={4} maxLength={10_000} defaultValue={prevValue(state, "body")} />
      </Field>
      <Button type="submit" loading={pending}>
        Send reply
      </Button>
    </form>
  );
}

export function CloseTicketButton({ id }: { id: string }) {
  return (
    <ConfirmDialog
      trigger={<Button variant="secondary">Close ticket</Button>}
      title="Close this ticket?"
      description="Close it if your issue is solved. You can open a new ticket any time."
      confirmLabel="Close ticket"
      onConfirm={() => runWithToast(() => closeTicketAction(id))}
    />
  );
}
