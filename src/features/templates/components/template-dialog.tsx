"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { SegmentMeter } from "@/components/dashboard/segment-meter";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import type { SegmentationRules } from "@/lib/sms-segments";
import { saveTemplateAction } from "../actions";

export interface TemplateValues {
  id: string;
  name: string;
  body: string;
  smsType: "TRANSACTIONAL" | "PROMOTIONAL";
}

export function TemplateDialog({ rules, template, open: o, onOpenChange }: { rules: SegmentationRules; template?: TemplateValues; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const [inner, setInner] = useState(false);
  const open = o ?? inner;
  const setOpen = onOpenChange ?? setInner;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!template && (
        <DialogTrigger asChild>
          <Button>
            <Plus /> New template
          </Button>
        </DialogTrigger>
      )}
      <DialogContent size="lg">{open && <TemplateForm rules={rules} template={template} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function TemplateForm({ rules, template, onDone }: { rules: SegmentationRules; template?: TemplateValues; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveTemplateAction, null);
  useActionFeedback(state, onDone);
  const [body, setBody] = useState(prevValue(state, "body") ?? template?.body ?? "");
  return (
    <form action={action} noValidate>
      <DialogHeader>
        <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
        <DialogDescription>Use variables like {"{{name}}"}, {"{{company}}"} or any contact custom field. They are filled per recipient.</DialogDescription>
      </DialogHeader>
      <DialogBody className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormStatus state={state && !state.ok ? state : null} />
        </div>
        {template && <input type="hidden" name="id" value={template.id} />}
        <Field label="Name" required error={fieldError(state, "name")}>
          <Input name="name" defaultValue={prevValue(state, "name") ?? template?.name} maxLength={80} autoFocus />
        </Field>
        <Field label="Type" required>
          <NativeSelect name="smsType" defaultValue={prevValue(state, "smsType") ?? template?.smsType ?? "TRANSACTIONAL"}>
            <option value="TRANSACTIONAL">Transactional</option>
            <option value="PROMOTIONAL">Promotional</option>
          </NativeSelect>
        </Field>
        <Field label="Message" required error={fieldError(state, "body")} className="sm:col-span-2">
          <Textarea name="body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1600} className="font-bangla text-[15px]" />
        </Field>
        <SegmentMeter text={body} rules={rules} className="sm:col-span-2 -mt-2" />
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {template ? "Save template" : "Create template"}
        </Button>
      </DialogFooter>
    </form>
  );
}
