"use client";

import { useActionState, useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormStatus, fieldError, prevValue } from "@/components/shared/form-status";
import { runWithToast, useActionFeedback } from "@/hooks/use-action-feedback";
import { deleteGroupAction, saveGroupAction } from "../actions";

type Group = { id: string; name: string; description: string | null };

function GroupForm({ group, onDone }: { group?: Group; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveGroupAction, null);
  useActionFeedback(state, onDone);
  return (
    <form action={action} noValidate>
      <DialogHeader>
        <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormStatus state={state && !state.ok ? state : null} />
        {group && <input type="hidden" name="id" value={group.id} />}
        <Field label="Name" required error={fieldError(state, "name")}>
          <Input name="name" defaultValue={prevValue(state, "name") ?? group?.name} maxLength={80} autoFocus />
        </Field>
        <Field label="Description" optional error={fieldError(state, "description")}>
          <Textarea name="description" rows={3} defaultValue={prevValue(state, "description") ?? group?.description ?? ""} maxLength={300} />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {group ? "Save" : "Create group"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function GroupDialog({ group, open: o, onOpenChange }: { group?: Group; open?: boolean; onOpenChange?: (v: boolean) => void }) {
  const [inner, setInner] = useState(false);
  const open = o ?? inner;
  const setOpen = onOpenChange ?? setInner;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!group && (
        <DialogTrigger asChild>
          <Button>
            <Plus /> New group
          </Button>
        </DialogTrigger>
      )}
      <DialogContent size="sm">{open && <GroupForm group={group} onDone={() => setOpen(false)} />}</DialogContent>
    </Dialog>
  );
}

export function GroupRowActions({ group }: { group: Group }) {
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`Actions for ${group.name}`}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          <ConfirmDialog
            trigger={
              <DropdownMenuItem destructive onSelect={(e) => e.preventDefault()}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            }
            destructive
            title={`Delete "${group.name}"?`}
            description="The group is removed; its contacts stay in your contact list."
            confirmLabel="Delete group"
            onConfirm={() => new Promise<void>((resolve) => start(async () => { await runWithToast(() => deleteGroupAction(group.id)); resolve(); }))}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <GroupDialog group={group} open={editing} onOpenChange={setEditing} />
    </>
  );
}
