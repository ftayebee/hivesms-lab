"use client";

import { ShieldAlert } from "lucide-react";
import { CopyButton } from "@/components/shared/copy-button";

/** One-time display of a secret with copy button and a clear warning. */
export function SecretReveal({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p>
          <strong>Copy it now.</strong> For your security we only store a hash, so it will never be shown again. If you lose it, create a new one and revoke this one.
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">{label}</p>
        <div className="flex items-center gap-2 rounded-md border border-border bg-code px-3 py-2">
          <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-code-foreground" data-testid="secret-value">
            {value}
          </code>
          <CopyButton value={value} variant="dark" />
        </div>
      </div>
    </div>
  );
}
