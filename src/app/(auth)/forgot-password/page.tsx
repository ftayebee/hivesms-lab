import Link from "next/link";
import { ForgotPasswordForm } from "@/features/auth/components/auth-forms";
import { getT } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Reset your password", description: "Request a password reset link.", path: "/forgot-password", noindex: true });

export default async function ForgotPasswordPage() {
  const { t } = await getT();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.forgotTitle}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.auth.forgotSubtitle}</p>
      <div className="mt-8">
        <ForgotPasswordForm />
      </div>
      <p className="mt-8 text-center text-sm">
        <Link href="/login" className="font-medium text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
