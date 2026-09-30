"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

/** Shows a success toast and runs onSuccess once per successful action result. */
export function useActionFeedback(state: ActionResult<unknown> | null, onSuccess?: () => void) {
  const last = useRef<ActionResult<unknown> | null>(null);
  useEffect(() => {
    if (!state || state === last.current) return;
    last.current = state;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      onSuccess?.();
    }
  }, [state, onSuccess]);
}

/** Wraps an imperative action call with toasts. Returns true on success. */
export async function runWithToast(fn: () => Promise<ActionResult<unknown>>) {
  const r = await fn();
  if (r.ok) {
    if (r.message) toast.success(r.message);
    return true;
  }
  toast.error(r.error);
  return false;
}
