"use client";

import { useActionState, useState, useTransition } from "react";
import { MoreHorizontal, Plus, Power, PowerOff, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast } from "@/hooks/use-action-feedback";
import { createWebhookAction, webhookOpAction } from "../actions";
import { SecretReveal } from "./secret-reveal";

export function CreateWebhookDialog({ events }: { events: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [k, setK] = useState(0);
  return (
    <Dialog open={open} onOpenChange={(o) => (setOpen(o), !o && setK((x) => x + 1))}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add endpoint
        </Button>
      </DialogTrigger>
      <DialogContent size="md">{open && <CreateForm key={k} events={events} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function CreateForm({ events, onDone }: { events: Record<string, string>; onDone: () => void }) {
  const [state, action, pending] = useActionState(createWebhookAction, null);
  if (state?.ok && state.data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Endpoint added</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <SecretReveal label="Signing secret" value={state.data.secret} />
          <p className="mt-4 text-sm text-muted-foreground">Use it to verify the X-SMSFlow-Signature header on every request. See the Webhooks documentation for code samples.</p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onDone}>I have copied the secret</Button>
        </DialogFooter>
      </>
    );
  }
  return (
    <form action={action} noValidate>
      <DialogHeader>
        <DialogTitle>Add webhook endpoint</DialogTitle>
        <DialogDescription>We POST JSON events to this HTTPS URL and retry failures with backoff.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormStatus state={state && !state.ok ? state : null} />
        <Field label="Endpoint URL" required error={fieldError(state, "url")}>
          <Input name="url" type="url" defaultValue={prevValue(state, "url")} placeholder="https://api.yourcompany.com/webhooks/sms" autoFocus />
        </Field>
        <Field label="Description" optional>
          <Input name="description" defaultValue={prevValue(state, "description")} maxLength={200} />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">Events</legend>
          <div className="mt-2 space-y-2">
            {Object.entries(events).map(([e, d]) => (
              <label key={e} className="flex items-start gap-2.5 text-sm">
                <Checkbox name="events" value={e} defaultChecked={e !== "campaign.completed"} className="mt-0.5" />
                <span>
                  <code className="font-mono text-[13px]">{e}</code>
                  <span className="block text-xs text-muted-foreground">{d}</span>
                </span>
              </label>
            ))}
          </div>
          {fieldError(state, "events") && <p className="mt-2 text-xs font-medium text-destructive">{fieldError(state, "events")}</p>}
        </fieldset>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Add endpoint
        </Button>
      </DialogFooter>
    </form>
  );
}

export function WebhookMenu({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const op = (o: "enable" | "disable" | "delete" | "test") => start(async () => void (await runWithToast(() => webhookOpAction(id, o))));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label="Endpoint actions" disabled={pending}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => op("test")} disabled={!active}>
          <Send /> Send test event
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => op(active ? "disable" : "enable")}>
          {active ? <PowerOff /> : <Power />} {active ? "Disable" : "Enable"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => op("delete")}>
          <Trash2 /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
