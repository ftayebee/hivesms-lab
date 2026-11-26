import { cn } from "@/lib/utils";
import { siteConfig } from "@/config/site";

/**
 * MZ SMS brand mark: a rounded message tile carrying the "MZ" monogram, with a small accent dot
 * for the message tail. A simple geometric mark so it can be swapped for a real logo file without
 * layout changes.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <text
        x="15.5"
        y="20.5"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="12.5"
        fontWeight="800"
        letterSpacing="-0.4"
        fill="var(--primary-foreground)"
      >
        MZ
      </text>
      <circle cx="25.5" cy="25.5" r="2.4" fill="var(--accent)" />
    </svg>
  );
}

export function Logo({ className, withText = true }: { className?: string; withText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-label={withText ? undefined : siteConfig.name}>
      <LogoMark />
      {withText && (
        <span className="text-[15px] font-semibold tracking-tight">
          MZ
          <span className="ml-1 rounded bg-accent-soft px-1 py-px text-[11px] font-semibold text-accent">SMS</span>
        </span>
      )}
    </span>
  );
}
