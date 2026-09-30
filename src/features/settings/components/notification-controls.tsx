"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markNotificationsReadAction } from "../actions";

export function MarkAllReadButton() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button variant="secondary" loading={pending} onClick={() => start(async () => (await markNotificationsReadAction(), router.refresh()))}>
      <CheckCheck /> Mark all as read
    </Button>
  );
}

/** Marks the notifications shown on screen as read after a short delay (unread highlight stays until reload). */
export function MarkReadOnView({ ids }: { ids: string[] }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const t = setTimeout(() => void markNotificationsReadAction(ids), 1500);
    return () => clearTimeout(t);
  }, [ids]);
  return null;
}
