import Link from "next/link";
import { Alert } from "@/components/ui/misc";
import { getSession } from "@/lib/auth/session";
import { findInvitation } from "@/features/team/service";
import { AcceptInvite, InviteSignupForm } from "@/features/team/components/invite-accept";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "Join your team", description: "Accept an invitation.", path: "/invite", noindex: true });

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [inv, session] = await Promise.all([findInvitation(token), getSession()]);
  if (!inv) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Invitation not valid</h1>
        <Alert tone="danger" className="mt-6">
          This invitation link is invalid, was revoked, or has expired. Ask the person who invited you to send a new one.
        </Alert>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Join {inv.organization.name}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        You were invited as <strong>{inv.role.name}</strong> ({inv.email}).
      </p>
      <div className="mt-8">
        {session ? (
          session.user.email === inv.email ? (
            <AcceptInvite token={token} orgName={inv.organization.name} />
          ) : (
            <Alert tone="warning" title="Signed in as a different user">
              You are signed in as {session.user.email}. Sign out and sign in as {inv.email} to accept.
            </Alert>
          )
        ) : (
          <>
            <InviteSignupForm token={token} email={inv.email} />
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className="font-medium text-primary hover:underline">
                Sign in to accept
              </Link>
            </p>
          </>
        )}
      </div>
    </>
  );
}
