import { Mail, Users } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/misc";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatDate, formatRelative } from "@/lib/format";
import { listTeam } from "@/features/team/service";
import { InviteDialog, MemberControls, PermissionMatrix, RevokeInviteButton } from "@/features/team/components/team-ui";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const { ctx, allowed } = await tenantWithPermission("team:read");
  if (!allowed) return <PermissionDenied permission="team:read" />;
  const { members, invitations, roles } = await listTeam(ctx);
  const canManage = can(ctx, "team:manage");
  const callerIsOwner = ctx.roleKey === "OWNER";
  const now = new Date();

  return (
    <>
      <PageHeader title="Team" description="People who can access this organization, and what each role can do." actions={canManage ? <InviteDialog canInviteOwner={callerIsOwner} /> : undefined} />
      <Card>
        <CardHeader>
          <CardTitle>Members ({members.length})</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <Avatar name={m.user.name} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {m.user.name}
                  {m.status !== "ACTIVE" && <Badge tone="neutral">Disabled</Badge>}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.user.email} · joined {formatDate(m.joinedAt)} · {m.user.lastLoginAt ? `last active ${formatRelative(m.user.lastLoginAt)}` : "never signed in"}
                </p>
              </div>
              {canManage ? (
                <MemberControls memberId={m.id} name={m.user.name} roleKey={m.role.key} status={m.status} isSelf={m.userId === ctx.userId} callerIsOwner={callerIsOwner} />
              ) : (
                <Badge tone="primary">{m.role.name}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
        </CardHeader>
        {invitations.length === 0 ? (
          <EmptyState icon={Mail} title="No pending invitations" className="py-8" />
        ) : (
          <ul className="divide-y divide-border">
            {invitations.map((i) => {
              const expired = i.expiresAt < now;
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                  <Mail className="size-4 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{i.email}</span>
                  <Badge tone="primary">{i.role.name}</Badge>
                  <span className={expired ? "text-destructive" : "text-muted-foreground"}>{expired ? "Expired" : `Expires ${formatDate(i.expiresAt)}`}</span>
                  {canManage && <RevokeInviteButton id={i.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" aria-hidden /> Roles and permissions
          </CardTitle>
          <CardDescription>Adjust what each role can do in this organization.</CardDescription>
        </CardHeader>
        <PermissionMatrix roles={roles} canEdit={canManage} callerIsOwner={callerIsOwner} />
      </Card>
    </>
  );
}
