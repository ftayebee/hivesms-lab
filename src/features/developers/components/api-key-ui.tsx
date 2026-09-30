"use client";

import { useActionState, useState } from "react";
import { KeyRound, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast } from "@/hooks/use-action-feedback";
import { API_SCOPES } from "@/lib/auth/permissions";
import { createApiKeyAction, revokeApiKeyAction } from "../actions";
import { SecretReveal } from "./secret-reveal";

export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setKey((k) => k + 1);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> Create API key
        </Button>
      </DialogTrigger>
      <DialogContent size="md">{open && <CreateForm key={key} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [state, action, pending] = useActionState(createApiKeyAction, null);
  if (state?.ok && state.data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Your new API key: {state.data.name}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <SecretReveal label="API key" value={state.data.fullKey} />
          <p className="mt-4 text-sm text-muted-foreground">
            Use it as <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. Keep it on your server; never put it in a mobile app or browser code.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button onClick={onDone}>I have copied the key</Button>
        </DialogFooter>
      </>
    );
  }
  const prevScopes = prevValue(state, "scopes");
  return (
    <form action={action} noValidate>
      <DialogHeader>
        <DialogTitle>Create API key</DialogTitle>
        <DialogDescription>Create one key per service or environment, with only the scopes it needs.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormStatus state={state && !state.ok ? state : null} />
        <Field label="Name" required hint="e.g. Checkout service (production)" error={fieldError(state, "name")}>
          <Input name="name" defaultValue={prevValue(state, "name")} maxLength={60} autoFocus />
        </Field>
        <fieldset>
          <legend className="text-sm font-medium">
            Scopes<span className="text-destructive" aria-hidden>*</span>
          </legend>
          <div className="mt-2 space-y-2">
            {Object.entries(API_SCOPES).map(([k, d]) => (
              <label key={k} className="flex items-start gap-2.5 text-sm">
                <Checkbox name="scopes" value={k} defaultChecked={prevScopes ? prevScopes.split(",").includes(k) : k !== "balance:read"} className="mt-0.5" />
                <span>
                  <code className="font-mono text-[13px]">{k}</code>
                  <span className="block text-xs text-muted-foreground">{d}</span>
                </span>
              </label>
            ))}
          </div>
          {fieldError(state, "scopes") && (
            <p role="alert" className="mt-2 text-xs font-medium text-destructive">
              {fieldError(state, "scopes")}
            </p>
          )}
        </fieldset>
        <Field label="IP allowlist" optional hint="Only these server IPs can use the key. One per line or comma separated. Leave empty to allow any IP." error={fieldError(state, "ipAllowlist")}>
          <Textarea name="ipAllowlist" rows={2} defaultValue={prevValue(state, "ipAllowlist")} className="font-mono text-[13px]" placeholder="203.0.113.10" />
        </Field>
        <Field label="Expires" optional>
          <NativeSelect name="expiresInDays" defaultValue={prevValue(state, "expiresInDays") ?? ""}>
            <option value="">Never</option>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="180">In 180 days</option>
            <option value="365">In 1 year</option>
          </NativeSelect>
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          <KeyRound /> Create key
        </Button>
      </DialogFooter>
    </form>
  );
}

export function RevokeKeyButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive">
          Revoke
        </Button>
      }
      destructive
      title={`Revoke "${name}"?`}
      description="Requests using this key will fail immediately. This cannot be undone."
      confirmLabel="Revoke key"
      confirmText="REVOKE"
      onConfirm={() => runWithToast(() => revokeApiKeyAction(id))}
    />
  );
}
