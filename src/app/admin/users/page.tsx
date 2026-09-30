import Link from "next/link";
import { Search, UserCog } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { AdminActionButton, AdminStatusSelect } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/format";
import { ADMIN_PAGE, listUsers } from "@/features/admin/service";
import { updateUserAccessAction } from "@/features/admin/actions";

export const metadata = { title: "Users" };

const ROLES = ["USER", "SUPPORT", "ADMIN", "SUPER_ADMIN"];

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const session = await requirePlatform("admin:users:manage");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const role = ROLES.find((r) => r === sp.role);
  const page = parsePage(sp.page);
  const { rows, total } = await listUsers({ q: q || undefined, role, page });
  const roleAction = async (userId: string, platformRole: string) => {
    "use server";
    return updateUserAccessAction(userId, { platformRole });
  };
  const statusAction = async (userId: string, status: string) => {
    "use server";
    return updateUserAccessAction(userId, { status });
  };
  return (
    <>
      <PageHeader title="Users" description="All user accounts. Platform roles grant access to this admin panel; changing a role signs the user out." />
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
                    <AdminStatusSelect label={`Platform role for ${u.email}`} value={u.platformRole} options={ROLES.map((r) => ({ value: r, label: r.replace("_", " ").toLowerCase() }))} action={roleAction.bind(null, u.id)} />
                    <AdminActionButton action={statusAction.bind(null, u.id, u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE")} label={u.status === "ACTIVE" ? "Suspend" : "Restore"} variant={u.status === "ACTIVE" ? "ghost" : "secondary"} confirmTitle={u.status === "ACTIVE" ? `Suspend ${u.email}?` : undefined} confirmDescription={u.status === "ACTIVE" ? "They are signed out everywhere and cannot sign in." : undefined} />
                  </div>
                ),
            },
          ]}
        />
        {rows.length > 0 && <Pagination page={page} pageSize={ADMIN_PAGE} total={total} searchParams={sp} basePath="/admin/users" />}
      </Card>
    </>
  );
}
