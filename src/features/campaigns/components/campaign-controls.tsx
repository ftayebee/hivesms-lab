"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, MoreHorizontal, Pause, Pencil, Play, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { campaignOpAction } from "../actions";

type Op = "pause" | "resume" | "cancel" | "duplicate" | "delete";

function useOp(id: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (op: Op, reason?: string) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await campaignOpAction(id, op, reason);
        if (r.ok) {
          toast.success(r.message ?? "Done.");
          if (op === "duplicate" && r.data?.id) router.push(`/dashboard/send?draft=${r.data.id}`);
          else if (op === "delete") router.push("/dashboard/campaigns");
          else router.refresh();
        } else toast.error(r.error);
        resolve(r.ok);
      }),
    );
  return { pending, run };
}

/** Primary controls on the campaign detail page. */
export function CampaignControls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const { pending, run } = useOp(id);
  const cancellable = ["DRAFT", "PENDING_REVIEW", "SCHEDULED", "PROCESSING", "PAUSED"].includes(status);
  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && (
        <Button onClick={() => router.push(`/dashboard/send?draft=${id}`)} disabled={pending}>
          <Pencil /> Edit draft
        </Button>
      )}
      {status === "PROCESSING" && (
        <Button variant="secondary" onClick={() => run("pause")} loading={pending}>
          <Pause /> Pause
        </Button>
      )}
      {status === "PAUSED" && (
        <Button onClick={() => run("resume")} loading={pending}>
          <Play /> Resume
        </Button>
      )}
      <Button variant="secondary" onClick={() => run("duplicate")} disabled={pending}>
        <Copy /> Duplicate
      </Button>
      {cancellable && <CancelDialog pending={pending} onConfirm={(reason) => run("cancel", reason)} />}
      {(status === "DRAFT" || status === "CANCELLED") && (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" disabled={pending} aria-label="Delete campaign">
              <Trash2 />
            </Button>
          }
          destructive
          title="Delete this campaign?"
          description="It will be removed from your campaign list."
          confirmLabel="Delete"
          onConfirm={() => run("delete")}
        />
      )}
    </div>
  );
}

/** Compact row menu for the campaigns list. */
export function CampaignRowMenu({ id, status, name }: { id: string; status: string; name: string }) {
  const router = useRouter();
  const { pending, run } = useOp(id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50" aria-label={`Actions for ${name}`} disabled={pending}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {status === "DRAFT" && (
          <DropdownMenuItem onSelect={() => router.push(`/dashboard/send?draft=${id}`)}>
            <Pencil /> Edit draft
          </DropdownMenuItem>
        )}
        {status === "PROCESSING" && (
          <DropdownMenuItem onSelect={() => run("pause")}>
            <Pause /> Pause
          </DropdownMenuItem>
        )}
        {status === "PAUSED" && (
          <DropdownMenuItem onSelect={() => run("resume")}>
            <Play /> Resume
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => run("duplicate")}>
          <Copy /> Duplicate
        </DropdownMenuItem>
        {["DRAFT", "PENDING_REVIEW", "SCHEDULED"].includes(status) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => run("cancel")}>
              <XCircle /> Cancel
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Cancel with an optional reason (recorded with the actor). */
function CancelDialog({ pending, onConfirm }: { pending: boolean; onConfirm: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Button variant="secondary" disabled={pending} className="text-destructive" onClick={() => setOpen(true)}>
        <XCircle /> Cancel campaign
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Cancel this campaign?</DialogTitle>
            <DialogDescription>
              Messages not yet sent will not be sent and their cost is refunded to your wallet. Messages already accepted by the provider cannot be recalled; messages with an unconfirmed outcome stay charged until reviewed.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <label htmlFor="cancel-reason" className="mb-1.5 block text-sm font-medium">
              Reason <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <Textarea id="cancel-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong recipient list" />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Keep campaign
            </Button>
            <Button variant="destructive" loading={pending} onClick={async () => (await onConfirm(reason.trim())) && setOpen(false)}>
              Cancel campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
