import { BadgeCheck, FileText, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { formatBDT, formatDate } from "@/lib/format";
import { getT } from "@/i18n/server";
import { loadSenderIdsPage } from "@/features/sender-ids/service";
import { laravelPage } from "@/lib/laravel-api";
import { RequestSenderIdDialog, SenderIdRowActions } from "@/features/sender-ids/components/sender-id-ui";
import type { StoredFile } from "@/services/storage";

export const metadata = { title: "Sender IDs" };

export default async function SenderIdsPage() {
  const { ctx, allowed } = await tenantWithPermission("sender_ids:read");
  if (!allowed) return <PermissionDenied permission="sender_ids:read" />;
  const { t } = await getT();
  const { senders, senderIdFee } = await laravelPage(() => loadSenderIdsPage(ctx));
  const canManage = can(ctx, "sender_ids:manage");
  const fee = Number(senderIdFee) > 0 ? formatBDT(senderIdFee.toString()) : null;
  const hasDefault = senders.some((s) => s.isDefault && s.status === "APPROVED");

  return (
    <>
      <PageHeader title="Sender IDs" description="The name or number recipients see as the sender." actions={canManage ? <RequestSenderIdDialog feeLabel={fee} /> : undefined} />
      <Alert tone="info" className="mb-6" title="How approval works">
        Masking sender IDs are reviewed by the upstream SMS provider and mobile operators, and may be subject to regulatory requirements. We forward your request with your documents. Approval is not guaranteed and timelines vary. {!hasDefault && `Until you have an approved default, messages are sent from the shared number ${process.env.SMS_DEFAULT_SENDER_ID ?? ""}.`}
      </Alert>

      {senders.length === 0 ? (
        <Card>
          <EmptyState icon={BadgeCheck} title="No sender IDs yet" description="Request a branded sender ID so customers recognise your messages." action={canManage ? <RequestSenderIdDialog feeLabel={fee} /> : undefined} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {senders.map((s) => {
            const docs = (s.documents as unknown as StoredFile[]) ?? [];
            return (
              <Card key={s.id}>
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 font-mono text-base">
                      {s.value}
                      {s.isDefault && s.status === "APPROVED" && (
                        <Badge tone="accent">
                          <Star /> Default
                        </Badge>
                      )}
                    </CardTitle>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge status={s.status} label={t.status[s.status as keyof typeof t.status]} />
                      <Badge tone="outline">{s.type === "MASKING" ? "Masking" : "Non-masking"}</Badge>
                    </div>
                  </div>
                  {canManage && <SenderIdRowActions id={s.id} status={s.status} isDefault={s.isDefault} />}
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {s.purpose && <p className="text-muted-foreground">{s.purpose}</p>}
                  {s.sampleMessage && <p className="rounded-md bg-surface px-3 py-2 font-bangla">{s.sampleMessage}</p>}
                  {s.status === "REJECTED" && s.rejectionReason && (
                    <Alert tone="danger" title="Not approved">
                      {s.rejectionReason} You can submit a new request with updated documents.
                    </Alert>
                  )}
                  {s.status === "SUSPENDED" && (
                    <Alert tone="warning" title="Suspended">
                      {s.rejectionReason ?? "This sender ID is suspended. Contact support."}
                    </Alert>
                  )}
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Requested</dt>
                      <dd className="mt-0.5">{formatDate(s.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{s.status === "REJECTED" ? "Reviewed" : "Approved"}</dt>
                      <dd className="mt-0.5">{s.approvedAt ? formatDate(s.approvedAt) : s.reviewedAt ? formatDate(s.reviewedAt) : "-"}</dd>
                    </div>
                  </dl>
                  {docs.length > 0 && (
                    <ul className="flex flex-wrap gap-2">
                      {docs.map((d, i) => (
                        <li key={d.key}>
                          <a href={`/api/v1/app/sender-ids/${s.id}/documents/${i}`} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted">
                            <FileText className="size-3.5" aria-hidden /> {d.name}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Documentation usually requested</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Trade licence or registration certificate in the organization&apos;s name.</li>
            <li>Proof that you own or are authorised to use the brand name (e.g. trademark, website ownership).</li>
            <li>For agencies: an authorisation letter from the brand owner.</li>
            <li>A sample of the messages you will send.</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Exact requirements depend on the provider and operators and may change.</p>
        </CardContent>
      </Card>
    </>
  );
}
