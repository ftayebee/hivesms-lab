import Link from "next/link";
import { cn } from "@/lib/utils";

/** Status filter pills that link to ?status=... (server-rendered). */
export function StatusTabs({ basePath, current, options }: { basePath: string; current?: string; options: { value?: string; label: string }[] }) {
  return (
    <nav aria-label="Filter by status" className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {options.map((o) => (
        <Link
          key={o.value ?? "all"}
          href={o.value ? `${basePath}?status=${o.value}` : basePath}
          aria-current={current === o.value ? "true" : undefined}
          className={cn("whitespace-nowrap rounded-full border px-3 py-1 text-sm", current === o.value ? "border-primary bg-primary-soft font-medium text-primary" : "border-border hover:bg-muted")}
        >
          {o.label}
        </Link>
      ))}
    </nav>
  );
}
