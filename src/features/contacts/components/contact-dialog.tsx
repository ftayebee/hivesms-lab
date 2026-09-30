"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/menu";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveContactAction } from "../actions";

export interface ContactFormValues {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  company: string | null;
  tags: string[];
  groupIds: string[];
  consentStatus: "OPTED_IN" | "UNKNOWN" | "OPTED_OUT";
  consentSource: string | null;
  customFields: Record<string, string>;
}

export function ContactDialog({
  groups,
  contact,
  trigger,
  open: controlledOpen,
  onOpenChange,
}: {
  groups: { id: string; name: string }[];
  contact?: ContactFormValues;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== null && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus /> Add contact
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent size="lg">{open && <ContactForm groups={groups} contact={contact} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function ContactForm({ groups, contact, onDone }: { groups: { id: string; name: string }[]; contact?: ContactFormValues; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveContactAction, null);
  useActionFeedback(state, onDone);
  const v = (name: keyof ContactFormValues | string, fallback?: string | null) => prevValue(state, name) ?? fallback ?? undefined;
  const custom = contact ? Object.entries(contact.customFields).map(([k, val]) => `${k}=${val}`).join("\n") : "";
  return (
    <form action={action} noValidate className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        <DialogDescription>Numbers are saved in +880 format. Only message people who agreed to hear from you.</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormStatus state={state && !state.ok ? state : null} />
        </div>
        {contact && <input type="hidden" name="id" value={contact.id} />}
        <Field label="Mobile number" required error={fieldError(state, "phone")}>
          <Input name="phone" type="tel" inputMode="tel" defaultValue={v("phone", contact?.phone)} placeholder="01712345678" autoFocus />
        </Field>
        <Field label="Name" optional error={fieldError(state, "name")}>
          <Input name="name" defaultValue={v("name", contact?.name)} maxLength={120} />
        </Field>
        <Field label="Email" optional error={fieldError(state, "email")}>
          <Input name="email" type="email" defaultValue={v("email", contact?.email)} />
        </Field>
        <Field label="Company" optional error={fieldError(state, "company")}>
          <Input name="company" defaultValue={v("company", contact?.company)} maxLength={120} />
        </Field>
        <Field label="Tags" optional hint="Comma separated, e.g. vip, dhaka" error={fieldError(state, "tags")} className="sm:col-span-2">
          <Input name="tags" defaultValue={v("tags", contact?.tags.join(", "))} />
        </Field>
        <Field label="Consent status" required error={fieldError(state, "consentStatus")}>
          <NativeSelect name="consentStatus" defaultValue={v("consentStatus", contact?.consentStatus ?? "UNKNOWN")}>
            <option value="OPTED_IN">Opted in</option>
            <option value="UNKNOWN">Unknown</option>
            <option value="OPTED_OUT">Opted out (suppressed)</option>
          </NativeSelect>
        </Field>
        <Field label="Consent source" optional hint="Where did they agree? e.g. checkout form" error={fieldError(state, "consentSource")}>
          <Input name="consentSource" defaultValue={v("consentSource", contact?.consentSource)} maxLength={120} />
        </Field>
        {groups.length > 0 && (
          <fieldset className="sm:col-span-2">
            <legend className="text-sm font-medium">Groups</legend>
            <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <Checkbox name="groupIds" value={g.id} defaultChecked={contact?.groupIds.includes(g.id)} />
                  <span className="truncate">{g.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Custom fields" optional hint="One per line as key=value, e.g. city=Dhaka. Use them as {{city}} in messages." error={fieldError(state, "customFields")} className="sm:col-span-2">
          <Textarea name="customFields" rows={3} defaultValue={v("customFields", custom)} className="font-mono text-[13px]" />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {contact ? "Save changes" : "Add contact"}
        </Button>
      </DialogFooter>
    </form>
  );
}
