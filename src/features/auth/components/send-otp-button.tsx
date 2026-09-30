"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { runWithToast } from "@/hooks/use-action-feedback";
import { sendOtpAction } from "../actions";

export function SendOtpButton() {
  const [pending, start] = useTransition();
  const [sent, setSent] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          if (await runWithToast(() => sendOtpAction())) setSent(true);
        })
      }
    >
      {sent ? "Send a new code" : "Send code"}
    </Button>
  );
}
