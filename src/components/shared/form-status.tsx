"use client";

import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/misc";
import type { ActionResult } from "@/lib/action-result";

/** Summary banner for a form's server action result; moves focus to errors for screen readers. */
export function FormStatus({ state }: { state: ActionResult<unknown> | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state && !state.ok) ref.current?.focus();
  }, [state]);
  if (!state) return null;
  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      {state.ok ? (
        state.message ? <Alert tone="success">{state.message}</Alert> : null
      ) : (
        <Alert tone="danger">{state.error}</Alert>
      )}
    </div>
  );
}

export function fieldError(state: ActionResult<unknown> | null, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name]?.[0] : undefined;
}

/** Previously submitted value (after a failed action), for use as defaultValue. */
export function prevValue(state: ActionResult<unknown> | null, name: string) {
  return state && !state.ok ? state.values?.[name] : undefined;
}
