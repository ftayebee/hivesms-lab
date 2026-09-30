import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/components/auth-forms";
import { Alert } from "@/components/ui/misc";
import { getSession } from "@/lib/auth/session";
import { getT } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Log in", description: "Sign in to your SMSFlow BD account.", path: "/login" });

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  if (await getSession()) redirect("/dashboard");
  const { t } = await getT();
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.loginTitle}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t.auth.loginSubtitle}</p>
      {sp.reset === "1" && (
        <Alert tone="success" className="mt-6">
          Your password was updated. Sign in with your new password.
        </Alert>
      )}
      <div className="mt-8">
        <LoginForm next={next} />
      </div>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        {t.auth.noAccount}{" "}
        <Link href="/register" className="font-medium text-primary hover:underline">
          {t.auth.createAccount}
        </Link>
      </p>
    </>
  );
}
