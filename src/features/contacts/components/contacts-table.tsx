"use client";

import { useState, useTransition } from "react";
import { MoreHorizontal, Pencil, Tag, Trash2, UserMinus, UserPlus, ShieldOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { runWithToast } from "@/hooks/use-action-feedback";
import { formatBdPhone } from "@/lib/phone";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { bulkContactsAction, deleteContactAction } from "../actions";
import type { BulkAction } from "../service";
import { ContactDialog, type ContactFormValues } from "./contact-dialog";

export interface ContactRow extends ContactFormValues {
  groupNames: string[];
  createdAt: string;
}

const CONSENT_LABEL = { OPTED_IN: "Opted in", UNKNOWN: "Unknown", OPTED_OUT: "Opted out" } as const;

export function ContactsTable({ rows, groups, canWrite }: { rows: ContactRow[]; groups: { id: string; name: string }[]; canWrite: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [groupDialog, setGroupDialog] = useState<"addToGroup" | "removeFromGroup" | null>(null);
  const [tagDialog, setTagDialog] = useState(false);
  const [pending, start] = useTransition();
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulk = (action: BulkAction) =>
    start(async () => {
      if (await runWithToast(() => bulkContactsAction([...selected], action))) setSelected(new Set());
    });

  return (
    <>
      {canWrite && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-primary-soft/60 px-4 py-2.5" role="region" aria-label="Bulk actions">
          <span className="mr-2 text-sm font-medium tabular">{selected.size} selected</span>
          <Button size="sm" variant="secondary" onClick={() => setGroupDialog("addToGroup")} disabled={pending || !groups.length}>
            <UserPlus /> Add to group
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setGroupDialog("removeFromGroup")} disabled={pending || !groups.length}>
            <UserMinus /> Remove from group
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setTagDialog(true)} disabled={pending}>
            <Tag /> Add tag
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" disabled={pending}>
                <ShieldCheck /> Consent
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => bulk({ type: "setConsent", consent: "OPTED_IN" })}>Mark opted in</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => bulk({ type: "setConsent", consent: "UNKNOWN" })}>Mark unknown</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => bulk({ type: "setConsent", consent: "OPTED_OUT" })}>
                <ShieldOff /> Mark opted out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="destructive" disabled={pending}>
                <Trash2 /> Delete
              </Button>
            }
            destructive
            title={`Delete ${selected.size} contact${selected.size === 1 ? "" : "s"}?`}
            description="They will be removed from all groups. Their message history is kept in reports."
            confirmLabel="Delete"
            onConfirm={() => bulk({ type: "delete" })}
          />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} className="ml-auto">
            Clear selection
          </Button>
        </div>
      )}

      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Contacts</caption>
          <thead className="bg-surface/70">
            <tr>
              {canWrite && (
                <th scope="col" className="w-10 border-b border-border px-4">
                  <Checkbox
                    aria-label="Select all contacts on this page"
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
              )}
              {["Contact", "Phone", "Groups", "Tags", "Consent", "Created"].map((h, i) => (
                <th key={h} scope="col" className={cn("h-10 whitespace-nowrap border-b border-border px-4 text-left text-xs font-medium text-muted-foreground", i >= 2 && i <= 3 && "hidden lg:table-cell", i === 5 && "hidden md:table-cell")}>
                  {h}
                </th>
              ))}
              <th scope="col" className="w-12 border-b border-border px-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id} className={cn("hover:bg-surface/60", selected.has(r.id) && "bg-primary-soft/40")}>
                {canWrite && (
                  <td className="px-4">
                    <Checkbox aria-label={`Select ${r.name ?? r.phone}`} checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <p className="font-medium">{r.name ?? <span className="text-muted-foreground">No name</span>}</p>
                  <p className="text-xs text-muted-foreground">{[r.email, r.company].filter(Boolean).join(" · ") || " "}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-[13px]">{formatBdPhone(r.phone)}</td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <div className="flex max-w-56 flex-wrap gap-1">
                    {r.groupNames.length ? r.groupNames.map((g) => <Badge key={g} tone="primary">{g}</Badge>) : <span className="text-muted-foreground">-</span>}
                  </div>
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <div className="flex max-w-48 flex-wrap gap-1">
                    {r.tags.length ? r.tags.map((t) => <Badge key={t} tone="outline">{t}</Badge>) : <span className="text-muted-foreground">-</span>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.consentStatus} label={CONSENT_LABEL[r.consentStatus]} />
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">{formatDate(r.createdAt)}</td>
                <td className="px-2 py-3 text-right">
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`Actions for ${r.name ?? r.phone}`}>
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setEditing(r)}>
                          <Pencil /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem destructive onSelect={() => start(async () => void (await runWithToast(() => deleteContactAction(r.id))))}>
                          <Trash2 /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <ContactDialog groups={groups} contact={editing} trigger={null} open onOpenChange={(o) => !o && setEditing(null)} />
      )}

      <Dialog open={groupDialog !== null} onOpenChange={(o) => !o && setGroupDialog(null)}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const groupId = String(new FormData(e.currentTarget).get("groupId") ?? "");
              if (groupDialog && groupId) bulk({ type: groupDialog, groupId });
              setGroupDialog(null);
            }}
          >
            <DialogHeader>
              <DialogTitle>{groupDialog === "addToGroup" ? "Add to group" : "Remove from group"}</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Field label="Group" required>
                <NativeSelect name="groupId" required>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setGroupDialog(null)}>
                Cancel
              </Button>
              <Button type="submit">Apply to {selected.size}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={tagDialog} onOpenChange={setTagDialog}>
        <DialogContent size="sm">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const tag = String(new FormData(e.currentTarget).get("tag") ?? "").trim();
              if (tag) bulk({ type: "addTag", tag });
              setTagDialog(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>Add tag</DialogTitle>
            </DialogHeader>
            <DialogBody>
              <Field label="Tag" required hint="Lower case, spaces become hyphens.">
                <Input name="tag" maxLength={40} required autoFocus />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setTagDialog(false)}>
                Cancel
              </Button>
              <Button type="submit">Add to {selected.size}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
