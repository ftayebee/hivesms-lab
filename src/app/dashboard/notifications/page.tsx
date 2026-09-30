import Link from "next/link";
import { Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requireTenant } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { listNotifications, NOTIFICATIONS_PAGE } from "@/features/settings/service";
import { MarkAllReadButton, MarkReadOnView } from "@/features/settings/components/notification-controls";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: PageProps<"/dashboard/notifications">) {
  const sp = await searchParams;
  const { ctx } = await requireTenant();
  const page = parsePage(sp.page);
  const { rows, total, unread } = await listNotifications(ctx, page);
  const unreadIds = rows.filter((r) => !r.readAt).map((r) => r.id);
  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          <>
            {unread > 0 && <MarkAllReadButton />}
            <Link href="/dashboard/settings#notifications" className="text-sm font-medium text-primary hover:underline">
              Preferences
            </Link>
          </>
        }
      />
      {unreadIds.length > 0 && <MarkReadOnView ids={unreadIds} />}
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications yet" description="Campaign results, payments and account alerts appear here." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {rows.map((n) => {
                const content = (
                  <div className={cn("flex gap-3 px-5 py-4", !n.readAt && "bg-primary-soft/40")}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {n.title}
                        {!n.readAt && <span className="sr-only"> (unread)</span>}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(n.createdAt)}</span>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link href={n.link} className="block hover:bg-surface/60">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
            <Pagination page={page} pageSize={NOTIFICATIONS_PAGE} total={total} searchParams={sp} basePath="/dashboard/notifications" />
          </>
        )}
      </Card>
    </>
  );
}
