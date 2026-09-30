"use client";

import { useTransition, useState } from "react";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { resendVerificationAction } from "@/features/auth/actions";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <Alert
      tone="warning"
      className="mb-6"
      title="Verify your email address"
      action={
        <Button
          size="sm"
          variant="secondary"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await resendVerificationAction();
              setMessage(r.ok ? (r.message ?? "Sent.") : r.error);
            })
          }
        >
          Resend link
        </Button>
      }
    >
      {message ?? `We sent a link to ${email}. Sending messages is available after verification.`}
    </Alert>
  );
}
