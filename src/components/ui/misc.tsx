import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn, initials } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden {...props} />;
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} className={cn(vertical ? "h-full w-px" : "h-px w-full", "bg-border", className)} />;
}

export function Progress({ value, max = 100, className, label, tone = "primary" }: { value: number; max?: number; className?: string; label: string; tone?: "primary" | "success" | "warning" | "danger" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colors = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", danger: "bg-destructive" };
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-500", colors[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Avatar({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary", className)}>
      {initials(name)}
    </span>
  );
}

const alertStyles = {
  info: { cls: "border-primary/25 bg-primary-soft text-foreground [&_svg]:text-primary", Icon: Info },
  success: { cls: "border-success/25 bg-success-soft text-foreground [&_svg]:text-success", Icon: CheckCircle2 },
  warning: { cls: "border-warning/30 bg-warning-soft text-foreground [&_svg]:text-warning", Icon: AlertTriangle },
  danger: { cls: "border-destructive/25 bg-destructive-soft text-foreground [&_svg]:text-destructive", Icon: AlertCircle },
};

export function Alert({ tone = "info", title, children, className, action }: { tone?: keyof typeof alertStyles; title?: React.ReactNode; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const { cls, Icon } = alertStyles[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", cls, className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn("text-muted-foreground", title && "mt-0.5")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{children}</kbd>;
}
