import { notFound } from "next/navigation";
import { ListChecks } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { laravel, laravelData, laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import { formatDateTime } from "@/lib/format";
import { CatalogAssign, CatalogToolbar } from "@/features/admin-ops/components";

export const metadata = { title: "Sender catalog" };

interface Entry {
  id: string;
  provider: string;
  value: string;
  type: "MASKING" | "NON_MASKING";
  providerStatus: string | null;
  source: "SYNC" | "MANUAL";
  active: boolean;
  note: string | null;
  lastSyncedAt: string | null;
  assignments: Array<{ organizationId: string; name: string | null; isDefault: boolean }>;
}

/** Customers for the assignment picker (first 500, newest first). */
async function customers() {
  const out: { id: string; name: string }[] = [];
  for (let page = 1; page <= 25; page++) {
    const res = await laravel.get<Array<{ id: string; name: string }>>("admin/customers", { page });
    out.push(...res.data.map((o) => ({ id: o.id, name: o.name })));
    if (res.data.length === 0 || page >= Number(res.meta.totalPages ?? 1)) break;
  }
  return out;
}

/** Provider sender IDs and which customers may use them (docs/22 §5). */
export default async function SenderCatalogPage() {
  if (!laravelEnabled("senderCatalog")) notFound();
  await requirePlatform("admin:sender_catalog:manage");
  const [entries, orgs] = await laravelPage(() => Promise.all([laravelData<Entry[]>("admin/sender-catalog"), customers()]));

  return (
    <>
      <PageHeader
        title="Sender catalog"
        description="Sender IDs available on the SMS provider account. Assign one to any number of customers; it then appears as approved in their sender list. Providers without a listing API (Automas) are maintained here by hand."
      />
      <Card className="mb-4">
        <CardContent className="pt-5">
          <CatalogToolbar canSync />
        </CardContent>
      </Card>
      <Card>
        <DataTable
          caption="Sender catalog"
          rows={entries}
          getKey={(e) => e.id}
          empty={<EmptyState icon={ListChecks} title="No sender IDs yet" description="Sync from the provider or add the ones approved on the provider panel." />}
          columns={[
            {
              key: "value",
              header: "Sender ID",
              mobile: "title",
              cell: (e) => (
                <span className="flex items-center gap-2">
                  <span className="font-medium">{e.value}</span>
                  {!e.active && <Badge tone="neutral">inactive</Badge>}
                </span>
              ),
            },
            { key: "type", header: "Type", cell: (e) => (e.type === "MASKING" ? "Masking" : "Non-masking") },
            { key: "source", header: "Source", cell: (e) => <span className="text-xs text-muted-foreground">{e.source === "SYNC" ? `${e.provider} sync${e.lastSyncedAt ? ` · ${formatDateTime(e.lastSyncedAt)}` : ""}` : "Manual"}</span> },
            { key: "assign", header: "Customers", cell: (e) => <CatalogAssign id={e.id} active={e.active} assigned={e.assignments.map((a) => a.organizationId)} organizations={orgs} /> },
          ]}
        />
      </Card>
    </>
  );
}
