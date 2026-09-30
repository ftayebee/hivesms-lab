"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { DatePicker, Input, Textarea } from "@/components/ui/input";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { submitAbuseReport } from "@/features/public/actions";

export function AbuseForm() {
  const [state, action, pending] = useActionState(submitAbuseReport, null);
  if (state?.ok) return <FormStatus state={state} />;
  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormStatus state={state} />
      </div>
      <Field label="Sender shown on the message" required hint="Brand name or number, e.g. SHOPNAME or 8809612345678" error={fieldError(state, "senderValue")}>
        <Input name="senderValue" defaultValue={prevValue(state, "senderValue")} required maxLength={30} />
      </Field>
      <Field label="When did you receive it?" optional error={fieldError(state, "receivedAt")}>
        <DatePicker name="receivedAt" defaultValue={prevValue(state, "receivedAt")} />
      </Field>
      <Field label="Message text" required className="sm:col-span-2" error={fieldError(state, "messageContent")}>
        <Textarea name="messageContent" defaultValue={prevValue(state, "messageContent")} rows={4} required maxLength={2000} />
      </Field>
      <Field label="Anything else we should know?" optional className="sm:col-span-2" error={fieldError(state, "description")}>
        <Textarea name="description" defaultValue={prevValue(state, "description")} rows={3} maxLength={2000} />
      </Field>
      <Field label="Your name" optional error={fieldError(state, "reporterName")}>
        <Input name="reporterName" defaultValue={prevValue(state, "reporterName")} autoComplete="name" />
      </Field>
      <Field label="Your email" optional hint="Only if you want us to follow up." error={fieldError(state, "reporterEmail")}>
        <Input name="reporterEmail" defaultValue={prevValue(state, "reporterEmail")} type="email" autoComplete="email" />
      </Field>
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <input name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="lg" loading={pending} loadingText="Submitting...">
          Submit report
        </Button>
      </div>
    </form>
  );
}
