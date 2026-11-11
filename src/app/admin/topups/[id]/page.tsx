import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { formatBDT, formatDateTime } from "@/lib/format";
import { adminRequest } from "@/features/manual-topups/laravel";
import { TOPUP_BADGE, TOPUP_STATUS_LABEL } from "@/features/manual-topups/types";
import { TopUpReviewActions } from "@/features/manual-topups/components/review-actions";

export const metadata = { title: "Manual payment" };

export default async function AdminTopUpPage({ params }: PageProps<"/admin/topups/[id]">) {
  if (!laravelEnabled("manualTopups")) notFound();
  const session = await requirePlatform("admin:topups:review");
  const { id } = await params;
  const r = await laravelPage(() => adminRequest(id));
  const open = r.status === "pending" || r.status === "under_review";
  const isImage = r.proofContentType?.startsWith("image/");

  return (
    <>
      <PageHeader
        back={{ href: "/admin/topups", label: "Manual payments" }}
        title={`${r.reference ?? "Request"} · ${formatBDT(r.total)}`}
        description={<span className="flex items-center gap-2"><StatusBadge status={TOPUP_BADGE[r.status]} label={TOPUP_STATUS_LABEL[r.status]} /> {r.organization?.name}</span>}
      />
      {r.flags.length > 0 && (
        <Alert tone="warning" className="mb-6" title="Check carefully">
          <ul className="list-disc pl-4">
            {r.flags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem] [&>*]:min-w-0">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Claim</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {[
                  ["Method", r.method],
                  ["Transaction ID", r.transactionId],
                  ["Paid from", r.senderNumber],
                  ["Paid at", r.paidAt ? formatDateTime(r.paidAt) : null],
                  ["Top-up (credit)", formatBDT(r.creditAmount)],
                  ["VAT", formatBDT(r.vatAmount)],
                  ["Total to receive", formatBDT(r.total)],
                  ["Submitted", formatDateTime(r.submittedAt)],
                  ["Customer note", r.note],
                  ["Decision", r.review ? `${r.review.decision} · ${formatDateTime(r.review.at)}${r.review.reason ? ` · ${r.review.reason}` : ""}` : null],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="mt-0.5 break-words font-medium">{v ?? "—"}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Proof</CardTitle>
            </CardHeader>
            <CardContent>
              {r.hasProof ? (
                isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private proof streamed through the BFF; viewing is audited
                  <img src={`/api/v1/admin/topup-requests/${r.id}/proof`} alt="Payment proof" className="max-h-[32rem] rounded-md border border-border object-contain" />
                ) : (
                  <a href={`/api/v1/admin/topup-requests/${r.id}/proof`} className="text-sm text-primary hover:underline">
                    Download {r.proofName}
                  </a>
                )
              ) : (
                <p className="text-sm text-muted-foreground">No proof attached. A screenshot is never proof on its own — check the receiving account.</p>
              )}
            </CardContent>
          </Card>
        </div>
        <TopUpReviewActions
          id={r.id}
          open={open}
          pending={r.status === "pending"}
          total={r.total}
          canApprove={platformCan(session.user.platformRole, "admin:topups:approve")}
          notes={r.internalNotes}
        />
      </div>
    </>
  );
}
