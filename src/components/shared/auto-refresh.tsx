"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders server data periodically while something is in progress (paused when the tab is hidden). */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
