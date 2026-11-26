"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { createCustomerAction } from "../create-customer";

export function CreateCustomerForm({ plans }: { plans: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createCustomerAction, null);

  return (
    <form action={action} noValidate className="space-y-5">
      <FormStatus state={state} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Company / organization" required error={fieldError(state, "company")}>
          <Input name="company" maxLength={120} defaultValue={prevValue(state, "company")} autoComplete="organization" />
        </Field>
        <Field label="Owner's full name" required error={fieldError(state, "name")}>
          <Input name="name" maxLength={100} defaultValue={prevValue(state, "name")} autoComplete="off" />
        </Field>
        <Field label="Email (sign-in)" required error={fieldError(state, "email")}>
          <Input name="email" type="email" maxLength={254} defaultValue={prevValue(state, "email")} autoComplete="off" />
        </Field>
        <Field label="Mobile number" optional hint="Bangladesh mobile, e.g. 01712345678. Can also be used to sign in." error={fieldError(state, "phone")}>
          <Input name="phone" inputMode="tel" maxLength={20} defaultValue={prevValue(state, "phone")} autoComplete="off" />
        </Field>
        <Field label="Password" required hint="At least 10 characters. Share it with the customer privately." error={fieldError(state, "password")}>
          <PasswordInput name="password" autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" required error={fieldError(state, "confirmPassword")}>
          <PasswordInput name="confirmPassword" autoComplete="new-password" />
        </Field>
        <Field label="Pricing plan" optional hint="Empty = the default plan. You can change it later on the customer page." error={fieldError(state, "pricingPlanId")}>
          <NativeSelect name="pricingPlanId" defaultValue={prevValue(state, "pricingPlanId") ?? ""}>
            <option value="">Default plan</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="emailVerified" defaultChecked className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>
            Mark the email as verified <span className="text-muted-foreground">(they can send SMS right away)</span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="sendWelcome" className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>
            Send the welcome email <span className="text-muted-foreground">(does not include the password)</span>
          </span>
        </label>
      </div>
      <Button type="submit" disabled={pending}>
        <UserPlus /> {pending ? "Creating…" : "Create customer"}
      </Button>
    </form>
  );
}
