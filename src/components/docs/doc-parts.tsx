import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="group">
      {children}
      <a href={`#${id}`} className="ml-2 !text-muted-foreground !no-underline opacity-0 group-hover:opacity-100" aria-label={`Link to ${typeof children === "string" ? children : "section"}`}>
        #
      </a>
    </h2>
  );
}

export function Endpoint({ method, path, scope }: { method: "GET" | "POST"; path: string; scope?: string }) {
  return (
    <div className="not-prose my-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-4 py-3">
      <Badge tone={method === "GET" ? "accent" : "primary"} className="font-mono">
        {method}
      </Badge>
      <code className="font-mono text-sm">{path}</code>
      {scope && <span className="ml-auto text-xs text-muted-foreground">Scope: <code className="font-mono">{scope}</code></span>}
    </div>
  );
}

export interface Param {
  name: string;
  type: string;
  required?: boolean;
  description: React.ReactNode;
}

export function ParamTable({ params, title = "Parameters" }: { params: Param[]; title?: string }) {
  return (
    <div className="not-prose my-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{title}</caption>
        <thead className="bg-surface">
          <tr>
            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Field</th>
            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Type</th>
            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {params.map((p) => (
            <tr key={p.name}>
              <td className="whitespace-nowrap px-4 py-2.5 align-top">
                <code className="font-mono text-[13px] font-medium">{p.name}</code>
                {p.required ? <span className="ml-2 text-xs text-destructive">required</span> : <span className="ml-2 text-xs text-muted-foreground">optional</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 align-top font-mono text-xs text-muted-foreground">{p.type}</td>
              <td className="px-4 py-2.5 align-top leading-relaxed text-muted-foreground">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Callout({ tone = "info", title, children }: { tone?: "info" | "warning"; title?: string; children: React.ReactNode }) {
  return (
    <div className={cn("not-prose my-5 rounded-lg border px-4 py-3 text-sm leading-relaxed", tone === "info" ? "border-primary/25 bg-primary-soft" : "border-warning/30 bg-warning-soft")}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}

export function CodeWrap({ children }: { children: React.ReactNode }) {
  return <div className="not-prose my-5">{children}</div>;
}
