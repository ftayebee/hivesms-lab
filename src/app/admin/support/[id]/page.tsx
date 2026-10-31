import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/states";
import { TicketThread } from "@/components/shared/ticket-thread";
import { AdminActionButton, AdminForm, AdminStatusSelect } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { getTicketForAdmin } from "@/features/admin/service";
import { laravelPage } from "@/lib/laravel-api";
import { staffReplyAction, ticketStatusAction } from "@/features/admin/actions";

export const metadata = { title: "Ticket" };

const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"].map((s) => ({ value: s, label: s.replace(/_/g, " ").toLowerCase() }));

export default async function AdminTicketPage({ params }: PageProps<"/admin/support/[id]">) {
  const session = await requirePlatform("admin:support");
  const { id } = await params;
  let t;
  try {
    t = await laravelPage(() => getTicketForAdmin(id));
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  return (
    <>
      <PageHeader
        back={{ href: "/admin/support", label: "Support" }}
        title={`#${t.number} ${t.subject}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/customers/${t.organization.id}`} className="font-medium text-foreground hover:text-primary">
              {t.organization.name}
            </Link>
            <span>
              · {t.createdBy.name} ({t.createdBy.email}) · {t.category} · opened {formatDateTime(t.createdAt)}
            </span>
            <Badge tone={t.priority === "URGENT" ? "danger" : t.priority === "HIGH" ? "warning" : "neutral"}>{t.priority.toLowerCase()}</Badge>
          </span>
        }
        actions={
          <>
            <AdminStatusSelect label="Ticket status" value={t.status} options={STATUS_OPTIONS} action={ticketStatusAction.bind(null, t.id)} />
            {t.assignedTo?.id !== session.user.id && <AdminActionButton action={ticketStatusAction.bind(null, t.id, t.status === "OPEN" ? "IN_PROGRESS" : t.status, true)} label="Assign to me" />}
          </>
        }
      />
      <Card>
        <CardContent className="space-y-6 pt-5">
          <p className="text-xs text-muted-foreground">Assigned to {t.assignedTo?.name ?? "nobody"}. Internal notes (yellow) are never shown to the customer.</p>
          <TicketThread messages={t.messages} staffLabel="Staff" />
          <div className="border-t border-border pt-5">
            <AdminForm action={staffReplyAction} submitLabel="Send">
              <input type="hidden" name="id" value={t.id} />
              <Field label="Reply">
                <Textarea name="body" rows={5} maxLength={10_000} />
              </Field>
              <div className="flex flex-wrap items-end gap-4">
                <Field label="Set status to" className="w-56">
                  <NativeSelect name="status" defaultValue="WAITING_FOR_CUSTOMER">
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="internal" className="size-4 accent-[var(--warning)]" /> Internal note (not sent to the customer)
                </label>
              </div>
            </AdminForm>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
