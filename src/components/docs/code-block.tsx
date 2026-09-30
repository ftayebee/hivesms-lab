"use client";

import { useState } from "react";
import { CopyButton } from "@/components/shared/copy-button";
import { cn } from "@/lib/utils";

export interface CodeSample {
  label: string;
  language: "bash" | "javascript" | "php" | "python" | "json" | "http";
  code: string;
}

/**
 * Tiny tokenizer for readable code samples without shipping a full highlighter.
 * Produces React nodes (no innerHTML), so sample content can never inject markup.
 */
const TOKEN = /(\/\/[^\n]*|#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b(?:const|let|await|async|function|return|import|from|true|false|null|new|echo|def|print|if|else|curl|POST|GET)\b|\$[A-Za-z_]\w*)/g;

function highlight(code: string, language: CodeSample["language"]) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of code.matchAll(TOKEN)) {
    const tok = m[0];
    const start = m.index ?? 0;
    // "#" is a comment only in bash/python; in other languages leave it alone.
    if (tok.startsWith("#") && !(language === "bash" || language === "python")) continue;
    if (start > last) out.push(code.slice(last, start));
    let cls = "";
    if (tok.startsWith("//") || tok.startsWith("#")) cls = "text-[#7d8bb0] italic";
    else if (tok.startsWith('"') || tok.startsWith("'")) cls = code[start + tok.length] === ":" && language === "json" ? "text-[#9fb4ff]" : "text-[#7ee0c9]";
    else if (/^\d/.test(tok)) cls = "text-[#f5c46a]";
    else if (tok.startsWith("$")) cls = "text-[#f59ab6]";
    else cls = "text-[#c3a6ff]";
    out.push(
      <span key={i++} className={cls}>
        {tok}
      </span>,
    );
    last = start + tok.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function ApiCodeBlock({ samples, title, className }: { samples: CodeSample[]; title?: string; className?: string }) {
  const [active, setActive] = useState(0);
  const sample = samples[active];
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border/60 bg-code text-code-foreground shadow-md", className)}>
      <div className="flex items-center gap-1 border-b border-white/10 px-2">
        {title && <span className="px-2 py-2.5 text-xs font-medium text-code-foreground/70">{title}</span>}
        <div role="tablist" aria-label="Language" className="flex min-w-0 flex-1 overflow-x-auto">
          {samples.length > 1 &&
            samples.map((s, i) => (
              <button
                key={s.label}
                role="tab"
                type="button"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
                  i === active ? "border-accent text-code-foreground" : "border-transparent text-code-foreground/60 hover:text-code-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
        </div>
        <CopyButton value={sample.code} variant="dark" />
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed" tabIndex={0} aria-label={`${sample.label} code sample`}>
        <code className="font-mono">{highlight(sample.code, sample.language)}</code>
      </pre>
    </div>
  );
}
