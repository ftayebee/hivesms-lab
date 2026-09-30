import { Check, Minus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { PLATFORM_PERMISSIONS, SYSTEM_ROLES, ROLE_ORDER, PERMISSIONS, type PlatformRoleKey } from "@/lib/auth/permissions";

export const metadata = { title: "Roles" };

const PLATFORM_ROLES: PlatformRoleKey[] = ["SUPPORT", "ADMIN", "SUPER_ADMIN"];

export default async function AdminRolesPage() {
  await requirePlatform("admin:access");
  return (
    <>
      <PageHeader title="Roles" description="Platform staff roles are defined in code (src/lib/auth/permissions.ts) so they cannot be escalated from the UI. Assign them on the Users page." />
      <Card>
        <CardHeader>
          <CardTitle>Platform staff permissions</CardTitle>
        </CardHeader>
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Platform role permissions</caption>
            <thead className="bg-surface/70">
              <tr>
                <th scope="col" className="h-10 border-b border-border px-4 text-left text-xs font-medium text-muted-foreground">Permission</th>
                {PLATFORM_ROLES.map((r) => (
                  <th key={r} scope="col" className="h-10 border-b border-border px-4 text-center text-xs font-medium text-muted-foreground">
                    {r.replace("_", " ").toLowerCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(PLATFORM_PERMISSIONS).map(([perm, roles]) => (
                <tr key={perm}>
                  <th scope="row" className="px-4 py-2 text-left font-mono text-xs font-normal">{perm}</th>
                  {PLATFORM_ROLES.map((r) => (
                    <td key={r} className="px-4 py-2 text-center">
                      {(roles as readonly string[]).includes(r) ? <Check className="mx-auto size-4 text-success" aria-label="Allowed" /> : <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="Not allowed" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Customer role templates</CardTitle>
          <CardDescription>Each organization gets a copy of these roles; owners can adjust non-owner roles for their own organization on the Team page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ROLE_ORDER.map((k) => (
            <div key={k} className="rounded-lg border border-border p-4">
              <p className="font-semibold">{SYSTEM_ROLES[k].name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{SYSTEM_ROLES[k].description}</p>
              <p className="mt-2 text-xs">
                {SYSTEM_ROLES[k].permissions.length} of {Object.keys(PERMISSIONS).length} permissions
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
