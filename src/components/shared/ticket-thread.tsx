import { Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ThreadMessage {
  id: string;
  body: string;
  isStaff: boolean;
  isInternal: boolean;
  createdAt: Date;
  author: { name: string };
}

/** Conversation view shared by the customer and admin ticket pages. Bodies are rendered as text. */
export function TicketThread({ messages, staffLabel = "Support team" }: { messages: ThreadMessage[]; staffLabel?: string }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => (
        <li key={m.id} className={cn("flex gap-3", m.isStaff && "flex-row-reverse text-right")}>
          <Avatar name={m.author.name} className={m.isStaff ? "bg-accent-soft text-accent" : undefined} />
          <div className={cn("max-w-[85%] rounded-lg border px-4 py-3 text-left", m.isInternal ? "border-warning/40 bg-warning-soft" : m.isStaff ? "border-accent/25 bg-accent-soft/50" : "border-border bg-card")}>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{m.author.name}</span>
              {m.isStaff && <Badge tone="accent">{staffLabel}</Badge>}
              {m.isInternal && <Badge tone="warning">Internal note</Badge>}
              <span>{formatDateTime(m.createdAt)}</span>
            </p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
