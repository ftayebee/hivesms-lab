import Link from "next/link";
import { ResetPasswordForm } from "@/features/auth/components/auth-forms";
import { Alert } from "@/components/ui/misc";
import { getT } from "@/i18n/server";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Choose a new password", description: "Set a new password for your account.", path: "/reset-password", noindex: true });

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const sp = await searchParams;
  const { t } = await getT();
  const token = typeof sp.token === "string" ? sp.token : "";
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.resetTitle}</h1>
      <div className="mt-8">
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <Alert tone="danger" title="Missing reset link">
            Open the link from your email, or{" "}
            <Link href="/forgot-password" className="font-medium text-primary hover:underline">
              request a new one
            </Link>
            .
          </Alert>
        )}
      </div>
    </>
  );
}
