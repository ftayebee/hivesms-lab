import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/states";
import { requireTenant } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatNumber, formatRelative } from "@/lib/format";
import { phoneVerificationEnabled } from "@/features/auth/service";
import { getNotificationPrefs, getOrganizationSettings, getProfile, listSessions } from "@/features/settings/service";
import { LeaveOrganizationButton, NotificationPrefsForm, OrganizationForm, PasswordForm, ProfileForm, SessionsList } from "@/features/settings/components/settings-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/dashboard/settings">) {
  const sp = await searchParams;
  const { ctx, session } = await requireTenant();
  const [user, org, sessions, prefs] = await Promise.all([
    getProfile(session.user.id),
    getOrganizationSettings(ctx),
    listSessions(session.user.id),
    getNotificationPrefs(session.user.id),
  ]);
  const canManage = can(ctx, "settings:manage");
  const sections = [
    { id: "profile", label: "Profile" },
    { id: "security", label: "Security" },
    { id: "organization", label: "Organization" },
    { id: "notifications", label: "Notifications" },
  ];

  return (
    <>
      <PageHeader title="Settings" />
      {sp.phone === "verified" && (
        <Alert tone="success" className="mb-6">
          Mobile number verified.
        </Alert>
      )}
      <div className="grid gap-8 lg:grid-cols-[12rem_1fr] [&>*]:min-w-0">
        <nav aria-label="Settings sections" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6">
          <Card id="profile" className="scroll-mt-24">
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileForm user={user} />
              {user.phone && (
                <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
                  {user.phoneVerifiedAt ? (
                    <span className="flex items-center gap-1.5 text-success">
                      <CheckCircle2 className="size-4" aria-hidden /> Mobile number verified
                    </span>
                  ) : phoneVerificationEnabled() ? (
                    <>
                      <span className="text-muted-foreground">Your mobile number is not verified.</span>
                      <Button asChild size="sm" variant="secondary">
                        <Link href="/dashboard/settings/verify-phone">Verify now</Link>
                      </Button>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Phone verification is not enabled on this platform.</span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card id="security" className="scroll-mt-24">
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>Changing your password signs out your other sessions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <PasswordForm />
              <div>
                <h3 className="mb-2 text-sm font-semibold">Active sessions</h3>
                <SessionsList sessions={sessions.map((s) => ({ id: s.id, ipAddress: s.ipAddress, userAgent: s.userAgent, lastSeenLabel: formatRelative(s.lastSeenAt) }))} currentId={session.sessionId} />
              </div>
            </CardContent>
          </Card>

          <Card id="organization" className="scroll-mt-24">
            <CardHeader>
              <CardTitle>Organization</CardTitle>
              {!canManage && <CardDescription>Only owners and admins can edit these details.</CardDescription>}
            </CardHeader>
            <CardContent className="space-y-6">
              <OrganizationForm org={org} disabled={!canManage} />
              <div className="rounded-lg bg-surface p-4 text-sm">
                <h3 className="font-semibold">Sending limits</h3>
                <p className="mt-1 text-muted-foreground">
                  Daily limit {formatNumber(org.dailySendLimit)} messages · monthly limit {formatNumber(org.monthlySendLimit)} messages · campaign review {org.requireCampaignReview ? "required" : "not required"}.
                  Limits protect you from runaway sends.{" "}
                  <Link href="/dashboard/support" className="font-medium text-primary hover:underline">
                    Ask support
                  </Link>{" "}
                  to change them.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">Leave this organization. Your personal account stays active.</p>
                <LeaveOrganizationButton orgName={org.name} />
              </div>
            </CardContent>
          </Card>

          <Card id="notifications" className="scroll-mt-24">
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Choose how you hear about activity in this organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <NotificationPrefsForm prefs={prefs} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
