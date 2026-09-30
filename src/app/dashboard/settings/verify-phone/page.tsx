import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { PageHeader } from "@/components/shared/states";
import { requireTenant } from "@/lib/auth/session";
import { formatBdPhone } from "@/lib/phone";
import { phoneVerificationEnabled } from "@/features/auth/service";
import { OtpForm } from "@/features/auth/components/auth-forms";
import { SendOtpButton } from "@/features/auth/components/send-otp-button";

export const metadata = { title: "Verify mobile number" };

export default async function VerifyPhonePage() {
  const { session } = await requireTenant();
  if (session.user.phoneVerifiedAt) redirect("/dashboard/settings?phone=verified");
  return (
    <>
      <PageHeader back={{ href: "/dashboard/settings", label: "Settings" }} title="Verify your mobile number" />
      <Card className="max-w-md">
        <CardContent className="space-y-5 pt-6">
          {!phoneVerificationEnabled() ? (
            <Alert tone="info">Phone verification is not enabled on this platform.</Alert>
          ) : !session.user.phone ? (
            <Alert tone="warning">Add a mobile number to your profile first.</Alert>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                We&apos;ll send a 6-digit code to <strong className="text-foreground">{formatBdPhone(session.user.phone)}</strong>. The code expires in 10 minutes.
              </p>
              <SendOtpButton />
              <OtpForm />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
