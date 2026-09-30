import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { TicketThread } from "@/components/shared/ticket-thread";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { isAppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { getTicket } from "@/features/support/service";
import { CloseTicketButton, ReplyForm } from "@/features/support/components/support-ui";

export const metadata = { title: "Support ticket" };

export default async function TicketPage({ params, searchParams }: PageProps<"/dashboard/support/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ctx, allowed } = await tenantWithPermission("support:read");
  if (!allowed) return <PermissionDenied permission="support:read" />;
  const { t } = await getT();
  let ticket;
  try {
    ticket = await getTicket(ctx, id);
  } catch (err) {
    if (isAppError(err) && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  const canWrite = can(ctx, "support:write");
  return (
    <>
      <PageHeader
        back={{ href: "/dashboard/support", label: "Support" }}
        title={`#${ticket.number} ${ticket.subject}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={ticket.status} label={t.status[ticket.status]} />
            <Badge tone="outline">{ticket.category}</Badge>
            <Badge tone={ticket.priority === "URGENT" ? "danger" : ticket.priority === "HIGH" ? "warning" : "neutral"}>{ticket.priority.toLowerCase()} priority</Badge>
            <span>
              Opened by {ticket.createdBy.name}, {formatDateTime(ticket.createdAt)}
            </span>
          </span>
        }
        actions={canWrite && ticket.status !== "CLOSED" ? <CloseTicketButton id={ticket.id} /> : undefined}
      />
      {sp.created === "1" && (
        <Alert tone="success" className="mb-6">
          Ticket created. We&apos;ll reply here and by email.
        </Alert>
      )}
      {ticket.status === "WAITING_FOR_CUSTOMER" && (
        <Alert tone="warning" className="mb-6">
          Our team is waiting for your reply.
        </Alert>
      )}
      <Card>
        <CardContent className="space-y-6 pt-5">
          <TicketThread messages={ticket.messages} />
          {canWrite &&
            (ticket.status === "CLOSED" ? (
              <p className="text-sm text-muted-foreground">This ticket is closed. Open a new ticket if you need more help.</p>
            ) : (
              <div className="border-t border-border pt-5">
                <ReplyForm ticketId={ticket.id} />
              </div>
            ))}
        </CardContent>
      </Card>
    </>
  );
}
