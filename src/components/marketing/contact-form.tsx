"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { submitContactRequest } from "@/features/public/actions";

const SUBJECTS = ["Sales enquiry", "Enterprise pricing", "Sender ID question", "Technical integration", "Billing", "Partnership", "Other"];

export function ContactForm() {
  const [state, action, pending] = useActionState(submitContactRequest, null);
  const params = useSearchParams();
  const preset = params.get("subject");
  if (state?.ok) {
    return <FormStatus state={state} />;
  }
  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormStatus state={state} />
      </div>
      <Field label="Name" required error={fieldError(state, "name")}>
        <Input name="name" defaultValue={prevValue(state, "name")} autoComplete="name" required maxLength={100} />
      </Field>
      <Field label="Company" optional error={fieldError(state, "company")}>
        <Input name="company" defaultValue={prevValue(state, "company")} autoComplete="organization" maxLength={120} />
      </Field>
      <Field label="Email" required error={fieldError(state, "email")}>
        <Input name="email" defaultValue={prevValue(state, "email")} type="email" autoComplete="email" required />
      </Field>
      <Field label="Phone" optional hint="Bangladesh mobile, e.g. 01712345678" error={fieldError(state, "phone")}>
        <Input name="phone" defaultValue={prevValue(state, "phone")} type="tel" autoComplete="tel" inputMode="tel" />
      </Field>
      <Field label="Subject" required className="sm:col-span-2" error={fieldError(state, "subject")}>
        <NativeSelect name="subject" defaultValue={prevValue(state, "subject") ?? (preset && SUBJECTS.includes(preset) ? preset : SUBJECTS[0])}>
          {SUBJECTS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Message" required className="sm:col-span-2" hint="Include your expected monthly volume if you're asking about pricing." error={fieldError(state, "message")}>
        <Textarea name="message" defaultValue={prevValue(state, "message")} rows={6} required maxLength={5000} />
      </Field>
      {/* Honeypot for bots: hidden from people and assistive tech */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" size="lg" loading={pending} loadingText="Sending...">
          Send message
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">We use your details only to respond to this enquiry. See our Privacy Policy.</p>
      </div>
    </form>
  );
}
