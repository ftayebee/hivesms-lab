"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert } from "@/components/ui/misc";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { acceptInviteAction, inviteSignupAction } from "../actions";

export function AcceptInvite({ token, orgName }: { token: string; orgName: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        size="lg"
        className="w-full"
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await acceptInviteAction(token);
            if (r && !r.ok) setError(r.error);
          })
        }
      >
        Join {orgName}
      </Button>
    </div>
  );
}

export function InviteSignupForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(inviteSignupAction, null);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormStatus state={state} />
      <input type="hidden" name="token" value={token} />
      <Field label="Email">
        <Input value={email} readOnly disabled />
      </Field>
      <Field label="Full name" required error={fieldError(state, "name")}>
        <Input name="name" autoComplete="name" defaultValue={prevValue(state, "name")} autoFocus />
      </Field>
      <Field label="Mobile number" optional error={fieldError(state, "phone")}>
        <Input name="phone" type="tel" inputMode="tel" defaultValue={prevValue(state, "phone")} />
      </Field>
      <Field label="Password" required hint="At least 10 characters, with a letter and a number." error={fieldError(state, "password")}>
        <PasswordInput name="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" required error={fieldError(state, "confirmPassword")}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Create account and join
      </Button>
    </form>
  );
}
