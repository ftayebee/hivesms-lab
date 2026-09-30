import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        primary: "bg-primary-soft text-primary",
        accent: "bg-accent-soft text-accent",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-destructive-soft text-destructive",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

const STATUS_TONES: Record<string, Tone> = {
  DELIVERED: "success",
  COMPLETED: "success",
  APPROVED: "success",
  ACTIVE: "success",
  SUCCEEDED: "success",
  RESOLVED: "success",
  OPTED_IN: "success",
  PAID: "success",
  SUBMITTED: "primary",
  PROCESSING: "primary",
  SCHEDULED: "primary",
  IN_PROGRESS: "primary",
  OPEN: "primary",
  QUEUED: "neutral",
  DRAFT: "neutral",
  CLOSED: "neutral",
  UNKNOWN: "neutral",
  EXPIRED: "neutral",
  CANCELLED: "neutral",
  REVOKED: "neutral",
  DISABLED: "neutral",
  PENDING: "warning",
  PENDING_REVIEW: "warning",
  PAUSED: "warning",
  WAITING_FOR_CUSTOMER: "warning",
  AWAITING_VERIFICATION: "warning",
  INVITED: "warning",
  FAILED: "danger",
  REJECTED: "danger",
  SUSPENDED: "danger",
  OPTED_OUT: "danger",
  REFUNDED: "neutral",
};

/** Consistent status pill; label is translated by the caller (see i18n status dictionary). */
export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} className={className}>
      {label ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ")}
    </Badge>
  );
}
