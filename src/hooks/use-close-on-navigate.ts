"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Open/close state that resets whenever the route changes (mobile menus, sheets).
 * Adjusts state during render instead of in an effect, as recommended by React.
 */
export function useCloseOnNavigate(): [boolean, (open: boolean) => void] {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    if (open) setOpen(false);
  }
  return [open, setOpen];
}
