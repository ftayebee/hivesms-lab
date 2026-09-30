"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, MoreHorizontal, Pause, Pencil, Play, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";
import { campaignOpAction } from "../actions";

type Op = "pause" | "resume" | "cancel" | "duplicate" | "delete";

function useOp(id: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (op: Op) =>
    new Promise<boolean>((resolve) =>
      start(async () => {
        const r = await campaignOpAction(id, op);
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
      {cancellable && (
        <ConfirmDialog
          trigger={
            <Button variant="secondary" disabled={pending} className="text-destructive">
              <XCircle /> Cancel campaign
            </Button>
          }
          destructive
          title="Cancel this campaign?"
          description="Messages not yet sent will not be sent and their cost is refunded to your wallet. Messages already sent cannot be recalled."
          confirmLabel="Cancel campaign"
          cancelLabel="Keep campaign"
          onConfirm={() => run("cancel")}
        />
      )}
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
