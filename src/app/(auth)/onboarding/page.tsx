import { redirect } from "next/navigation";
import { OnboardingForm } from "@/features/auth/components/auth-forms";
import { requireSession, getTenantContext } from "@/lib/auth/session";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Create an organization", description: "Set up your organization.", path: "/onboarding", noindex: true });

export default async function OnboardingPage() {
  await requireSession();
  if (await getTenantContext()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create an organization</h1>
      <p className="mt-2 text-sm text-muted-foreground">You are not a member of any organization yet. Create one, or ask a colleague to invite you to theirs.</p>
      <div className="mt-8">
        <OnboardingForm />
      </div>
    </>
  );
}
