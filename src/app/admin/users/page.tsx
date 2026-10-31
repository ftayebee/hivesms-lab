import Link from "next/link";
import { Search, UserCog } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Alert } from "@/components/ui/misc";
import { PasswordInput } from "@/components/ui/password-input";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { AccessChangeButton, AdminForm } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { laravelPage } from "@/lib/laravel-api";
import { staffHistory, superAdminAvailable } from "@/features/admin/super-admin";
import { ADMIN_PAGE, listUsers } from "@/features/admin/service";
import { inviteStaffAction, updateUserAccessAction } from "@/features/admin/actions";

export const metadata = { title: "Users" };

const ROLES = ["USER", "SUPPORT", "ADMIN", "SUPER_ADMIN"];

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const session = await requirePlatform("admin:users:manage");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const role = ROLES.find((r) => r === sp.role);
  const page = parsePage(sp.page);
  const { rows, total } = await listUsers({ q: q || undefined, role, page });
  const laravelAdmin = superAdminAvailable();
  const history = laravelAdmin ? await laravelPage(() => staffHistory(1)) : null;
  return (
    <>
      <PageHeader title="Users & staff" description="All user accounts. Platform roles grant access to this admin panel. Every access change needs a reason and your password, signs the user out and is audited." />
      {laravelAdmin ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Invite staff</CardTitle>
            <CardDescription>Grants a staff role to an existing account, or creates the account and e-mails a link to set a password. Nobody sees another person&apos;s password. Give the least privilege that does the job.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminForm action={inviteStaffAction} className="grid gap-4 sm:grid-cols-2" submitLabel="Invite">
              <Field label="E-mail" required>
                <Input name="email" type="email" autoComplete="off" maxLength={254} />
              </Field>
              <Field label="Name" required>
                <Input name="name" maxLength={100} />
              </Field>
              <Field label="Staff role" required hint="Support: customers, messages, reviews, support. Admin: also billing review and finance reports. Super admin: everything, including money and staff.">
                <NativeSelect name="role" defaultValue="SUPPORT">
                  <option value="SUPPORT">support</option>
                  <option value="ADMIN">admin</option>
                  <option value="SUPER_ADMIN">super admin (platform owner)</option>
                </NativeSelect>
              </Field>
              <Field label="Reason" required>
                <Input name="reason" maxLength={500} />
              </Field>
              <Field label="Your current password" required>
                <PasswordInput name="currentPassword" autoComplete="current-password" maxLength={200} />
              </Field>
            </AdminForm>
          </CardContent>
        </Card>
      ) : (
        <Alert tone="info" className="mb-6" title="Staff invitations">
          Inviting staff and the privileged-action history need the Laravel admin API (LARAVEL_FEATURES <code>admin</code>). Role and status changes below already require a reason and your password.
        </Alert>
      )}
      <Card>
        <form method="get" className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row" role="search">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="uq" className="sr-only">
              Search users
            </label>
            <Input id="uq" name="q" defaultValue={q} placeholder="Name or email" className="pl-9" />
          </div>
          <label htmlFor="ur" className="sr-only">
            Platform role
          </label>
          <NativeSelect id="ur" name="role" defaultValue={role ?? ""} className="sm:w-44">
            <option value="">All roles</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        <DataTable
          caption="Users"
          rows={rows}
          getKey={(u) => u.id}
          empty={<EmptyState icon={UserCog} title="No users found" />}
          columns={[
            { key: "name", header: "User", mobile: "title", cell: (u) => <div><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></div> },
            { key: "orgs", header: "Organizations", cell: (u) => <div className="flex max-w-60 flex-wrap gap-1">{u.memberships.map((m) => <Link key={m.organization.id} href={`/admin/customers/${m.organization.id}`}><Badge tone="outline">{m.organization.name}</Badge></Link>)}</div> },
            { key: "verified", header: "Email", cell: (u) => (u.emailVerifiedAt ? <Badge tone="success">verified</Badge> : <Badge tone="warning">unverified</Badge>) },
            { key: "login", header: "Last sign-in", cell: (u) => <span className="whitespace-nowrap text-muted-foreground">{u.lastLoginAt ? formatRelative(u.lastLoginAt) : "never"}</span> },
            { key: "created", header: "Joined", cell: (u) => <span className="text-muted-foreground">{formatDate(u.createdAt)}</span> },
            { key: "status", header: "Status", cell: (u) => <StatusBadge status={u.status} /> },
            {
              key: "role",
              header: "Platform role",
              mobile: "hidden",
              cell: (u) =>
                u.id === session.user.id ? (
                  <span className="text-xs text-muted-foreground">{u.platformRole.toLowerCase()} (you)</span>
                ) : (
                  <div className="flex items-center gap-2">
                    <Badge tone={u.platformRole === "USER" ? "outline" : "primary"}>{u.platformRole.replace("_", " ").toLowerCase()}</Badge>
                    <AccessChangeButton email={u.email} role={u.platformRole} status={u.status} roles={ROLES} action={updateUserAccessAction.bind(null, u.id)} />
                  </div>
                ),
            },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={ADMIN_PAGE} total={total} searchParams={sp} basePath="/admin/users" />}
      </Card>
      {history && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Privileged staff actions</CardTitle>
            <CardDescription>Access changes, invitations, owner bootstrap and failed password confirmations (latest 50).</CardDescription>
          </CardHeader>
          <ul className="divide-y divide-border text-sm">
            {history.rows.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                <code className="font-mono text-xs">{a.action}</code>
                <span className="text-muted-foreground">{a.actor?.name ?? a.actorType.toLowerCase()}</span>
                {typeof a.metadata?.reason === "string" && <span className="min-w-0 flex-1 truncate text-muted-foreground">“{a.metadata.reason}”</span>}
                <span className="ml-auto text-xs text-muted-foreground">{a.createdAt ? formatDateTime(a.createdAt) : ""}</span>
              </li>
            ))}
            {history.rows.length === 0 && <li className="px-5 py-4 text-muted-foreground">No privileged actions yet.</li>}
          </ul>
        </Card>
      )}
    </>
  );
}
