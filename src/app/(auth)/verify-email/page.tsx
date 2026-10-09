import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { verifyEmailToken } from "@/features/auth/service";
import { isAppError } from "@/lib/errors";
import { laravel, isLaravelApiError } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Verify your email", description: "Confirm your email address.", path: "/verify-email", noindex: true });

/**
 * Verification requires an explicit click (POST) rather than happening on page load, so email
 * security scanners that pre-fetch links cannot consume the token.
 */
async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  try {
    if (laravelEnabled("auth")) await laravel.post("auth/email/verify", { token }, { auth: false });
    else await verifyEmailToken(token);
  } catch (err) {
    const message = isAppError(err) ? err.message : isLaravelApiError(err) && err.status < 500 ? err.userMessage : "Verification failed.";
    redirect(`/verify-email?error=${encodeURIComponent(message)}`);
  }
  // The redirect is a client-side navigation: drop the cached dashboard layout so the
  // "verify your email" banner reflects the new state.
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard?verified=1");
}

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const error = typeof sp.error === "string" ? sp.error : "";
  return (
    <>
      <span className="grid size-11 place-items-center rounded-full bg-primary-soft text-primary">
        <MailCheck className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Verify your email</h1>
      {error ? (
        <Alert tone="danger" className="mt-6">
          {error} You can request a new link from your dashboard.
        </Alert>
      ) : token ? (
        <form action={confirm} className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">Click the button to confirm this email address for your account.</p>
          <input type="hidden" name="token" value={token} />
          <Button type="submit" size="lg" className="w-full">
            Confirm email address
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Open the verification link we emailed you. It expires after 24 hours.</p>
      )}
      <p className="mt-8 text-sm">
        <Link href="/dashboard" className="font-medium text-primary hover:underline">
          Go to dashboard
        </Link>
      </p>
    </>
  );
}
