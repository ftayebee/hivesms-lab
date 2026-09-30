"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Checkbox } from "@/components/ui/menu";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { useI18n } from "@/i18n/client";
import { createOrganizationAction, forgotPasswordAction, loginAction, registerAction, resetPasswordAction, verifyOtpAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormStatus state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label={t.auth.identifier} required error={fieldError(state, "identifier")}>
        <Input name="identifier" defaultValue={prevValue(state, "identifier")} autoComplete="username" autoFocus required placeholder="you@company.com" />
      </Field>
      <Field
        label={t.auth.password}
        required
        error={fieldError(state, "password")}
        labelAction={
          <Link href="/forgot-password" className="text-sm font-medium text-primary hover:underline">
            {t.auth.forgot}
          </Link>
        }
      >
        <PasswordInput name="password" autoComplete="current-password" required />
      </Field>
      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox name="remember" />
        {t.auth.remember}
      </label>
      <Button type="submit" size="lg" className="w-full" loading={pending} loadingText={t.auth.signingIn}>
        {t.auth.signIn}
      </Button>
    </form>
  );
}

export function RegisterForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(registerAction, null);
  return (
    <form action={action} className="grid gap-5 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormStatus state={state} />
      </div>
      <Field label={t.auth.name} required error={fieldError(state, "name")}>
        <Input name="name" defaultValue={prevValue(state, "name")} autoComplete="name" required maxLength={100} />
      </Field>
      <Field label={t.auth.company} required error={fieldError(state, "company")}>
        <Input name="company" defaultValue={prevValue(state, "company")} autoComplete="organization" required maxLength={120} />
      </Field>
      <Field label={t.auth.email} required className="sm:col-span-2" error={fieldError(state, "email")}>
        <Input name="email" defaultValue={prevValue(state, "email")} type="email" autoComplete="email" required />
      </Field>
      <Field label={t.auth.phone} required hint="Bangladesh mobile number, e.g. 01712345678" className="sm:col-span-2" error={fieldError(state, "phone")}>
        <Input name="phone" defaultValue={prevValue(state, "phone")} type="tel" inputMode="tel" autoComplete="tel" required />
      </Field>
      <Field label={t.auth.password} required hint={t.auth.passwordHint} error={fieldError(state, "password")}>
        <PasswordInput name="password" autoComplete="new-password" required minLength={10} />
      </Field>
      <Field label={t.auth.confirmPassword} required error={fieldError(state, "confirmPassword")}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" required />
      </Field>
      <div className="sm:col-span-2">
        <label className="flex items-start gap-2.5 text-sm leading-relaxed">
          <Checkbox name="acceptTerms" className="mt-0.5" aria-describedby={fieldError(state, "acceptTerms") ? "terms-error" : undefined} />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
              Terms and Conditions
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="font-medium text-primary hover:underline">
              Privacy Policy
            </Link>
            , and I will only message people who agreed to hear from us.
          </span>
        </label>
        {fieldError(state, "acceptTerms") && (
          <p id="terms-error" role="alert" className="mt-2 text-xs font-medium text-destructive">
            {fieldError(state, "acceptTerms")}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full sm:col-span-2" loading={pending} loadingText={t.auth.creatingAccount}>
        {t.auth.createAccount}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  if (state?.ok) return <FormStatus state={state} />;
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormStatus state={state} />
      <Field label={t.auth.email} required error={fieldError(state, "email")}>
        <Input name="email" defaultValue={prevValue(state, "email")} type="email" autoComplete="email" required autoFocus />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {t.auth.sendResetLink}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormStatus state={state} />
      <input type="hidden" name="token" value={token} />
      <Field label="New password" required hint={t.auth.passwordHint} error={fieldError(state, "password")}>
        <PasswordInput name="password" autoComplete="new-password" required autoFocus />
      </Field>
      <Field label={t.auth.confirmPassword} required error={fieldError(state, "confirmPassword")}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {t.auth.resetPassword}
      </Button>
    </form>
  );
}

export function OtpForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState(verifyOtpAction, null);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormStatus state={state} />
      <Field label={t.auth.code} required error={fieldError(state, "code")}>
        <Input name="code" defaultValue={prevValue(state, "code")} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className="h-11 text-center font-mono text-lg tracking-[0.5em]" />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        {t.auth.verify}
      </Button>
    </form>
  );
}

export function OnboardingForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, null);
  return (
    <form action={action} className="space-y-5" noValidate>
      <FormStatus state={state} />
      <Field label="Organization name" required error={fieldError(state, "company")}>
        <Input name="company" defaultValue={prevValue(state, "company")} autoComplete="organization" required autoFocus />
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={pending}>
        Create organization
      </Button>
    </form>
  );
}
