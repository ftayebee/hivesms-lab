import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/features/auth/components/auth-forms";
import { GoogleButton } from "@/features/auth/components/google-button";
import { googleProvider } from "@/features/auth/google";
import { registrationOpen } from "@/features/auth/service";
import { Alert } from "@/components/ui/misc";
import { getSession } from "@/lib/auth/session";
import { getT } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Create an account", description: "Create an SMSFlow BD account to send SMS in Bangladesh from a dashboard or the API.", path: "/register" });

export default async function RegisterPage() {
  if (await getSession()) redirect("/dashboard");
  const { t } = await getT();
  const google = await googleProvider();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.registerTitle}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.auth.registerSubtitle}</p>
      <div className="mt-8">
        {registrationOpen() ? (
          <>
            {google && <GoogleButton label={t.auth.continueWithGoogle} divider={t.auth.orDivider} />}
            <RegisterForm />
          </>
        ) : (
          <Alert tone="info" title="Registration is by invitation">
            New accounts are currently opened by our sales team.{" "}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              Contact us
            </Link>{" "}
            to get started.
          </Alert>
        )}
      </div>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t.auth.haveAccount}{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t.auth.signIn}
        </Link>
      </p>
    </>
  );
}
