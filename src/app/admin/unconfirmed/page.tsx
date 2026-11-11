import { notFound } from "next/navigation";
import { CircleHelp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { laravel, laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { formatBDT, formatDateTime } from "@/lib/format";
import { ResolveMessageButtons } from "@/features/admin-ops/components";

export const metadata = { title: "Unconfirmed messages" };

interface Row {
  id: string;
  to: string;
  senderValue: string;
  cost: string;
  provider: string | null;
  providerStatusCode: string | null;
  providerRequestedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  batchNumber: number | null;
  createdAt: string;
  organization?: { id: string; name: string } | null;
  campaign?: { id: string; name: string } | null;
}

/** Messages whose provider outcome is unknown (timeout, worker crash). Never resent or refunded automatically (docs/21). */
export default async function UnconfirmedPage({ searchParams }: PageProps<"/admin/unconfirmed">) {
  if (!laravelEnabled("admin")) notFound();
  const session = await requirePlatform("admin:messages:read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const res = await laravelPage(() => laravel.get<Row[]>("admin/messages/unconfirmed", { page }));
  const canResolve = platformCan(session.user.platformRole, "admin:messages:resolve");

  return (
    <>
      <PageHeader
        title="Unconfirmed messages"
        description="The provider may or may not have taken these messages. Check the provider panel or report, then record the real outcome. Only a failed outcome can be refunded."
      />
      <Card>
        <DataTable
          caption="Unconfirmed messages"
          rows={res.data}
          getKey={(m) => m.id}
          empty={<EmptyState icon={CircleHelp} title="Nothing to review" description="Every message has a confirmed provider outcome." />}
          columns={[
            { key: "org", header: "Customer", mobile: "title", cell: (m) => <span className="font-medium">{m.organization?.name ?? "—"}</span> },
            { key: "campaign", header: "Campaign", cell: (m) => <span className="text-muted-foreground">{m.campaign?.name ?? "API / single"}{m.batchNumber ? ` · batch ${m.batchNumber}` : ""}</span> },
            { key: "to", header: "Recipient", cell: (m) => <span className="font-mono text-xs">{m.to}</span> },
            { key: "sender", header: "Sender", cell: (m) => m.senderValue },
            { key: "cost", header: "Cost", align: "right", cell: (m) => formatBDT(m.cost) },
            { key: "why", header: "Why", cell: (m) => <span className="text-xs text-muted-foreground">{m.errorCode ?? m.providerStatusCode ?? "—"}</span> },
            { key: "at", header: "Sent at", cell: (m) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(m.providerRequestedAt ?? m.createdAt)}</span> },
            { key: "actions", header: <span className="sr-only">Actions</span>, mobile: "hidden", cell: (m) => (canResolve ? <ResolveMessageButtons id={m.id} /> : null) },
          ]}
        />
        {res.data.length > 0 && <Pagination page={page} pageSize={Number(res.meta.pageSize ?? 50)} total={Number(res.meta.total ?? 0)} searchParams={sp} basePath="/admin/unconfirmed" />}
      </Card>
    </>
  );
}
