"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast, useActionFeedback } from "@/hooks/use-action-feedback";
import { changePasswordAction } from "@/features/auth/actions";
import { leaveOrganizationAction, revokeSessionAction, saveNotificationPrefsAction, updateOrganizationAction, updateProfileAction } from "../actions";

export function ProfileForm({ user }: { user: { name: string; email: string; phone: string | null; locale: string } }) {
  const [state, action, pending] = useActionState(updateProfileAction, null);
  useActionFeedback(state);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormStatus state={state && !state.ok ? state : null} />
      </div>
      <Field label="Full name" required error={fieldError(state, "name")}>
        <Input name="name" defaultValue={prevValue(state, "name") ?? user.name} autoComplete="name" />
      </Field>
      <Field label="Email" hint="Contact support to change your sign-in email.">
        <Input value={user.email} readOnly disabled />
      </Field>
      <Field label="Mobile number" optional hint="Changing it requires verifying the new number." error={fieldError(state, "phone")}>
        <Input name="phone" type="tel" inputMode="tel" defaultValue={prevValue(state, "phone") ?? user.phone ?? ""} autoComplete="tel" />
      </Field>
      <Field label="Language">
        <NativeSelect name="locale" defaultValue={prevValue(state, "locale") ?? user.locale}>
          <option value="en">English</option>
          <option value="bn">বাংলা (Bangla)</option>
        </NativeSelect>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={pending}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState(changePasswordAction, null);
  useActionFeedback(state, () => ref.current?.reset());
  return (
    <form ref={ref} action={action} className="grid max-w-md gap-4" noValidate>
      <FormStatus state={state && !state.ok ? state : null} />
      <Field label="Current password" required error={fieldError(state, "currentPassword")}>
        <PasswordInput name="currentPassword" autoComplete="current-password" />
      </Field>
      <Field label="New password" required hint="At least 10 characters, with a letter and a number." error={fieldError(state, "password")}>
        <PasswordInput name="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" required error={fieldError(state, "confirmPassword")}>
        <PasswordInput name="confirmPassword" autoComplete="new-password" />
      </Field>
      <div>
        <Button type="submit" loading={pending}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function SessionsList({ sessions, currentId }: { sessions: { id: string; ipAddress: string | null; userAgent: string | null; lastSeenLabel: string }[]; currentId: string }) {
  const [pending, start] = useTransition();
  const describe = (ua: string | null) => {
    if (!ua) return "Unknown device";
    const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
    return `${browser}${os ? ` on ${os}` : ""}`;
  };
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {sessions.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
          <Monitor className="size-4 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {describe(s.userAgent)} {s.id === currentId && <span className="ml-1 text-xs font-normal text-success">(this device)</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {s.ipAddress ?? "unknown IP"} · active {s.lastSeenLabel}
            </p>
          </div>
          {s.id !== currentId && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => void (await runWithToast(() => revokeSessionAction(s.id))))}>
              Sign out
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function OrganizationForm({ org, disabled }: { org: { name: string; industry: string | null; website: string | null; address: string | null; billingEmail: string | null; taxId: string | null }; disabled: boolean }) {
  const [state, action, pending] = useActionState(updateOrganizationAction, null);
  useActionFeedback(state);
  const v = (k: keyof typeof org) => prevValue(state, k) ?? org[k] ?? "";
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <FormStatus state={state && !state.ok ? state : null} />
      </div>
      <fieldset disabled={disabled} className="contents">
        <Field label="Organization name" required error={fieldError(state, "name")}>
          <Input name="name" defaultValue={v("name")} />
        </Field>
        <Field label="Industry" optional>
          <Input name="industry" defaultValue={v("industry")} />
        </Field>
        <Field label="Website" optional error={fieldError(state, "website")}>
          <Input name="website" type="url" defaultValue={v("website")} placeholder="https://" />
        </Field>
        <Field label="Billing email" optional hint="Receives invoices and payment receipts." error={fieldError(state, "billingEmail")}>
          <Input name="billingEmail" type="email" defaultValue={v("billingEmail")} />
        </Field>
        <Field label="Billing address" optional className="sm:col-span-2">
          <Textarea name="address" rows={2} defaultValue={v("address")} />
        </Field>
        <Field label="BIN / VAT registration" optional hint="Printed on your VAT invoices.">
          <Input name="taxId" defaultValue={v("taxId")} />
        </Field>
      </fieldset>
      {!disabled && (
        <div className="sm:col-span-2">
          <Button type="submit" loading={pending}>
            Save organization
          </Button>
        </div>
      )}
    </form>
  );
}

export function NotificationPrefsForm({ prefs }: { prefs: { type: string; label: string; inApp: boolean; email: boolean }[] }) {
  const [state, setState] = useState(prefs);
  const [pending, start] = useTransition();
  const set = (type: string, key: "inApp" | "email", value: boolean) => setState((s) => s.map((p) => (p.type === type ? { ...p, [key]: value } : p)));
  return (
    <div>
      <table className="w-full text-sm">
        <caption className="sr-only">Notification preferences</caption>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th scope="col" className="py-2 text-left font-medium">Notification</th>
            <th scope="col" className="w-20 py-2 text-center font-medium">In app</th>
            <th scope="col" className="w-20 py-2 text-center font-medium">Email</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {state.map((p) => (
            <tr key={p.type}>
              <th scope="row" className="py-2.5 text-left font-normal">
                {p.label}
              </th>
              <td className="text-center">
                <Switch checked={p.inApp} onCheckedChange={(v) => set(p.type, "inApp", v)} aria-label={`${p.label} in app`} />
              </td>
              <td className="text-center">
                <Switch checked={p.email} onCheckedChange={(v) => set(p.type, "email", v)} aria-label={`${p.label} by email`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button className="mt-4" loading={pending} onClick={() => start(async () => void (await runWithToast(() => saveNotificationPrefsAction(state))))}>
        Save preferences
      </Button>
    </div>
  );
}

export function LeaveOrganizationButton({ orgName }: { orgName: string }) {
  return (
    <ConfirmDialog
      trigger={<Button variant="secondary" className="text-destructive">Leave organization</Button>}
      destructive
      title={`Leave ${orgName}?`}
      description="You lose access immediately. An admin can invite you again."
      confirmLabel="Leave"
      confirmText="LEAVE"
      onConfirm={() => runWithToast(() => leaveOrganizationAction())}
    />
  );
}
