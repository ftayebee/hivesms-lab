import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";

/**
 * Brand mark: a rounded message tile with two "flow" lines. A simple geometric mark so it can be
 * swapped for a real logo file without layout changes.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path d="M9 12.5h14" stroke="var(--primary-foreground)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 18.5h8.5" stroke="var(--primary-foreground)" strokeWidth="2.4" strokeLinecap="round" opacity=".85" />
      <circle cx="22.5" cy="18.5" r="2.2" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      {withText && (
        <span className="text-[15px] font-semibold tracking-tight">
          {siteConfig.shortName}
          <span className="ml-1 rounded bg-accent-soft px-1 py-px text-[11px] font-semibold text-accent">BD</span>
        </span>
      )}
    </span>
  );
}
