import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatDate, formatNumber } from "@/lib/format";
import { listGroups } from "@/features/contacts/service";
import { GroupDialog, GroupRowActions } from "@/features/contacts/components/group-dialog";

export const metadata = { title: "Contact groups" };

export default async function GroupsPage() {
  const { ctx, allowed } = await tenantWithPermission("contacts:read");
  if (!allowed) return <PermissionDenied permission="contacts:read" />;
  const groups = await listGroups(ctx);
  const canWrite = can(ctx, "contacts:write");
  return (
    <>
      <PageHeader title="Groups" description="Use groups to choose campaign audiences." actions={canWrite ? <GroupDialog /> : undefined} />
      <Card>
        {groups.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No groups yet" description="Create a group, then add contacts to it from the contacts list or during CSV import." action={canWrite ? <GroupDialog /> : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/dashboard/contacts?group=${g.id}`} className="font-medium hover:text-primary">
                    {g.name}
                  </Link>
                  {g.description && <p className="mt-0.5 truncate text-sm text-muted-foreground">{g.description}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular">{formatNumber(g.count)}</p>
                  <p className="text-xs text-muted-foreground">contacts</p>
                </div>
                <p className="hidden w-28 text-right text-xs text-muted-foreground sm:block">Created {formatDate(g.createdAt)}</p>
                {canWrite && <GroupRowActions group={{ id: g.id, name: g.name, description: g.description }} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
