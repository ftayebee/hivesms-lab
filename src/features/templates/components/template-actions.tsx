"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Pencil, Send, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { runWithToast } from "@/hooks/use-action-feedback";
import type { SegmentationRules } from "@/lib/sms-segments";
import { deleteTemplateAction } from "../actions";
import { TemplateDialog, type TemplateValues } from "./template-dialog";

export function TemplateActions({ template, rules, canWrite, canSend }: { template: TemplateValues; rules: SegmentationRules; canWrite: boolean; canSend: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted" aria-label={`Actions for ${template.name}`}>
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {canSend && (
            <DropdownMenuItem asChild>
              <Link href={`/dashboard/send?template=${template.id}`}>
                <Send /> Use in composer
              </Link>
            </DropdownMenuItem>
          )}
          {canWrite && (
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil /> Edit
            </DropdownMenuItem>
          )}
          {canWrite && (
            <ConfirmDialog
              trigger={
                <DropdownMenuItem destructive onSelect={(e) => e.preventDefault()}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              }
              destructive
              title={`Delete "${template.name}"?`}
              description="Campaigns that already used it are not affected."
              confirmLabel="Delete"
              onConfirm={() => runWithToast(() => deleteTemplateAction(template.id))}
            />
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canWrite && <TemplateDialog rules={rules} template={template} open={editing} onOpenChange={setEditing} />}
    </>
  );
}
