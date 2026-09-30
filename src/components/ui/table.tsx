import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function Table({ className, caption, children }: { className?: string; caption?: string; children: React.ReactNode }) {
  return (
    <div className={cn("relative w-full overflow-x-auto", className)}>
      <table className="w-full caption-bottom border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}
export const THead = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <thead className={cn("bg-surface/70", className)} {...p} />;
export const TBody = ({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody className={cn("divide-y divide-border", className)} {...p} />;
export const TR = ({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) => <tr className={cn("transition-colors hover:bg-surface/60", className)} {...p} />;
export const TH = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th scope="col" className={cn("h-10 whitespace-nowrap border-b border-border px-4 text-left text-xs font-medium text-muted-foreground", className)} {...p} />
);
export const TD = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-3 align-middle", className)} {...p} />;

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  align?: "left" | "right";
  /** On mobile cards: "title" is the card heading, "hidden" omits the field. */
  mobile?: "title" | "hidden" | "field";
}

/**
 * Responsive data table: a real <table> from md up, stacked cards below md so no column is lost
 * on phones. Works in server components (cells are rendered on the server).
 */
export function DataTable<T>({
  rows,
  columns,
  getKey,
  caption,
  empty,
  className,
}: {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => string;
  caption: string;
  empty?: React.ReactNode;
  className?: string;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  return (
    <div className={className}>
      <Table caption={caption} className="hidden md:block">
        <THead>
          <tr>
            {columns.map((c) => (
              <TH key={c.key} className={cn(c.align === "right" && "text-right", c.className)}>
                {c.header}
              </TH>
            ))}
          </tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={getKey(row)}>
              {columns.map((c) => (
                <TD key={c.key} className={cn(c.align === "right" && "text-right tabular", c.className)}>
                  {c.cell(row)}
                </TD>
              ))}
            </TR>
          ))}
        </TBody>
      </Table>
      <ul className="divide-y divide-border md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={getKey(row)} className="px-4 py-3">
            <div className="mb-2 font-medium">{titleCol.cell(row)}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {columns
                .filter((c) => c !== titleCol && c.mobile !== "hidden")
                .map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-xs text-muted-foreground">{c.header}</dt>
                    <dd className="mt-0.5 truncate">{c.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Link-based pagination: works without JavaScript and keeps other query params. */
export function Pagination({
  page,
  pageSize,
  total,
  searchParams,
  basePath,
}: {
  page: number;
  pageSize: number;
  total: number;
  searchParams: Record<string, string | string[] | undefined>;
  basePath: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-[13px] font-medium hover:bg-muted";
  return (
    <nav aria-label="Pagination" className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground sm:flex-row">
      <p className="tabular">
        Showing <span className="font-medium text-foreground">{from}</span> to <span className="font-medium text-foreground">{to}</span> of{" "}
        <span className="font-medium text-foreground">{total.toLocaleString("en-US")}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={btn} href={href(page - 1)} rel="prev">
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </Link>
        ) : (
          <span className={cn(btn, "pointer-events-none opacity-50")} aria-disabled>
            <ChevronLeft className="size-4" aria-hidden /> Previous
          </span>
        )}
        <span className="tabular px-1 text-[13px]">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link className={btn} href={href(page + 1)} rel="next">
            Next <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(btn, "pointer-events-none opacity-50")} aria-disabled>
            Next <ChevronRight className="size-4" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  );
}

export function parsePage(v: string | string[] | undefined) {
  const n = Number(typeof v === "string" ? v : 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
