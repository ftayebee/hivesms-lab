"use client";

import { Fragment, useActionState, useState, useTransition } from "react";
import { MoreHorizontal, Save, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast, useActionFeedback } from "@/hooks/use-action-feedback";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { changeRoleAction, inviteAction, memberStatusAction, revokeInviteAction, updateRolePermissionsAction } from "../actions";

const ROLES = [
  { key: "OWNER", name: "Owner" },
  { key: "ADMIN", name: "Admin" },
  { key: "MANAGER", name: "Manager" },
  { key: "DEVELOPER", name: "Developer" },
  { key: "VIEWER", name: "Viewer" },
];

export function InviteDialog({ canInviteOwner }: { canInviteOwner: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent size="sm">{open && <InviteForm canInviteOwner={canInviteOwner} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

function InviteForm({ canInviteOwner, onDone }: { canInviteOwner: boolean; onDone: () => void }) {
  const [state, action, pending] = useActionState(inviteAction, null);
  useActionFeedback(state, onDone);
  return (
    <form action={action} noValidate>
      <DialogHeader>
        <DialogTitle>Invite a team member</DialogTitle>
        <DialogDescription>They receive an email link that is valid for 7 days.</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormStatus state={state && !state.ok ? state : null} />
        <Field label="Email" required error={fieldError(state, "email")}>
          <Input name="email" type="email" defaultValue={prevValue(state, "email")} autoFocus />
        </Field>
        <Field label="Role" required>
          <NativeSelect name="role" defaultValue={prevValue(state, "role") ?? "MANAGER"}>
            {ROLES.filter((r) => r.key !== "OWNER" || canInviteOwner).map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Send invitation
        </Button>
      </DialogFooter>
    </form>
  );
}

export function MemberControls({ memberId, name, roleKey, status, isSelf, callerIsOwner }: { memberId: string; name: string; roleKey: string; status: string; isSelf: boolean; callerIsOwner: boolean }) {
  const [pending, start] = useTransition();
  if (isSelf) return <span className="text-xs text-muted-foreground">You</span>;
  const lockedOwner = roleKey === "OWNER" && !callerIsOwner;
  return (
    <div className="flex items-center justify-end gap-2">
      <label className="sr-only" htmlFor={`role-${memberId}`}>
        Role for {name}
      </label>
      <NativeSelect
        id={`role-${memberId}`}
        defaultValue={roleKey}
        disabled={pending || lockedOwner}
        className="h-8 w-32 text-[13px]"
        onChange={(e) => {
          const v = e.target.value;
          start(async () => {
            const ok = await runWithToast(() => changeRoleAction(memberId, v));
            if (!ok) e.target.value = roleKey;
          });
        }}
      >
        {ROLES.filter((r) => r.key !== "OWNER" || callerIsOwner || roleKey === "OWNER").map((r) => (
          <option key={r.key} value={r.key}>
            {r.name}
          </option>
        ))}
      </NativeSelect>
      {!lockedOwner && (
        <DropdownMenu>
          <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`More actions for ${name}`} disabled={pending}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => start(async () => void (await runWithToast(() => memberStatusAction(memberId, status === "ACTIVE" ? "disable" : "enable"))))}>
              {status === "ACTIVE" ? "Disable access" : "Re-enable access"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <ConfirmDialog
              trigger={
                <DropdownMenuItem destructive onSelect={(e) => e.preventDefault()}>
                  Remove from organization
                </DropdownMenuItem>
              }
              destructive
              title={`Remove ${name}?`}
              description="They lose access to this organization immediately. Their past activity stays in the audit log."
              confirmLabel="Remove"
              onConfirm={() => runWithToast(() => memberStatusAction(memberId, "remove"))}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={() => start(async () => void (await runWithToast(() => revokeInviteAction(id))))}>
      Revoke
    </Button>
  );
}

/** Editable permission matrix: one column per role, grouped rows per permission. */
export function PermissionMatrix({ roles, canEdit, callerIsOwner }: { roles: { key: string; name: string; permissions: string[] }[]; canEdit: boolean; callerIsOwner: boolean }) {
  const [state, setState] = useState(() => Object.fromEntries(roles.map((r) => [r.key, new Set(r.permissions)])));
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const editable = (key: string) => canEdit && key !== "OWNER" && (key !== "ADMIN" || callerIsOwner);
  const groups = Object.entries(PERMISSIONS).reduce<Record<string, [string, string][]>>((acc, [k, v]) => {
    (acc[v.group] ??= []).push([k, v.description]);
    return acc;
  }, {});
  const toggle = (role: string, perm: string) => {
    setState((s) => {
      const next = new Set(s[role]);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return { ...s, [role]: next };
    });
    setDirty((d) => new Set(d).add(role));
  };
  const save = () =>
    start(async () => {
      for (const role of dirty) await runWithToast(() => updateRolePermissionsAction(role, [...state[role]]));
      setDirty(new Set());
    });
  return (
    <div>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Role permissions</caption>
          <thead className="bg-surface/70">
            <tr>
              <th scope="col" className="h-10 border-b border-border px-4 text-left text-xs font-medium text-muted-foreground">
                Permission
              </th>
              {roles.map((r) => (
                <th key={r.key} scope="col" className="h-10 border-b border-border px-3 text-center text-xs font-medium text-muted-foreground">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(groups).map(([group, perms]) => (
              <Fragment key={group}>
                <tr>
                  <th colSpan={roles.length + 1} scope="colgroup" className="bg-muted/40 px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </th>
                </tr>
                {perms.map(([perm, desc]) => (
                  <tr key={perm} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-2 text-left font-normal">
                      <span className="block">{desc}</span>
                      <code className="font-mono text-[11px] text-muted-foreground">{perm}</code>
                    </th>
                    {roles.map((r) => (
                      <td key={r.key} className="px-3 py-2 text-center">
                        <Checkbox
                          aria-label={`${r.name}: ${desc}`}
                          checked={state[r.key].has(perm)}
                          disabled={!editable(r.key) || pending}
                          onCheckedChange={() => toggle(r.key, perm)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-muted-foreground">The Owner role always has every permission.{!callerIsOwner && " Only owners can edit the Admin role."}</p>
          <Button onClick={save} disabled={!dirty.size} loading={pending}>
            <Save /> Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
