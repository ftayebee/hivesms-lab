import Link from "next/link";
import { Calculator } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Alert } from "@/components/ui/misc";
import { DataTable, Pagination, parsePage } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { AdminForm } from "@/components/admin/admin-ui";
import { RangeFilter } from "@/components/admin/range-filter";
import { requirePlatform } from "@/lib/auth/session";
import { platformCan } from "@/lib/auth/permissions";
import { laravelPage } from "@/lib/laravel-api";
import { formatBDT, formatDateTime, formatNumber } from "@/lib/format";
import { margins, parseRange, providerCosts, superAdminAvailable } from "@/features/admin/super-admin";
import { saveProviderCostsAction } from "@/features/admin/actions";

export const metadata = { title: "Provider costs & margins" };

const GROUPS = [
  { value: "organization", label: "By customer" },
  { value: "plan", label: "By plan" },
  { value: "campaign", label: "By campaign" },
  { value: "day", label: "By day" },
];
const RATE_FIELDS = [
  ["transactionalNonMasking", "Transactional, non-masking"],
  ["transactionalMasking", "Transactional, masking"],
  ["promotionalNonMasking", "Promotional, non-masking"],
  ["promotionalMasking", "Promotional, masking"],
] as const;

export default async function AdminCostsPage({ searchParams }: PageProps<"/admin/costs">) {
  const session = await requirePlatform("admin:finance:read");
  const sp = await searchParams;
  if (!superAdminAvailable()) {
    return (
      <>
        <PageHeader title="Provider costs & margins" />
        <Alert tone="info" title="Needs the Laravel admin API">
          Costs and margins are computed by the Laravel API. They appear once LARAVEL_FEATURES includes <code>admin</code>.
        </Alert>
      </>
    );
  }
  const range = parseRange(sp);
  const groupBy = GROUPS.find((g) => g.value === sp.groupBy)?.value ?? "organization";
  const page = parsePage(sp.page);
  const [costs, m] = await Promise.all([laravelPage(() => providerCosts()), laravelPage(() => margins({ ...range, groupBy, page }))]);
  const canManage = platformCan(session.user.platformRole, "admin:costs:manage");
  const c = costs.current;
  const estimate = m.basis === "estimate";

  return (
    <>
      <PageHeader title="Provider costs & margins" description="Retail is what customers were charged; provider cost is an estimate from the wholesale rates below until provider invoices are reconciled." />
      <div className="grid gap-6 xl:grid-cols-3 [&>*]:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Configured wholesale rates</CardTitle>
            <CardDescription>BDT per SMS segment. Configuration only: the sending provider is never changed here.</CardDescription>
          </CardHeader>
          {c ? (
            <dl className="divide-y divide-border text-sm">
              {RATE_FIELDS.map(([k, label]) => (
                <div key={k} className="flex justify-between px-5 py-2.5">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="tabular">{formatBDT(c.rates[k], "en", { decimals: 4 })}</dd>
                </div>
              ))}
              <div className="px-5 py-2.5 text-xs text-muted-foreground">
                Provider <code>{c.provider}</code> · from {c.effectiveFrom} · source: {c.source}
              </div>
            </dl>
          ) : (
            <CardContent>
              <Badge tone="warning">not configured</Badge>
              <p className="mt-2 text-sm text-muted-foreground">No rates are invented. Enter verified rates from your provider contract or invoice.</p>
            </CardContent>
          )}
        </Card>
        {canManage && (
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>{c ? "Update rates" : "Set verified rates"}</CardTitle>
              <CardDescription>Super admin only. Needs a source, a reason and your password; the change is audited with before and after.</CardDescription>
            </CardHeader>
            <CardContent>
              <AdminForm action={saveProviderCostsAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" submitLabel="Save rates">
                <Field label="Provider key" required>
                  <Input name="provider" defaultValue={c?.provider ?? ""} maxLength={30} />
                </Field>
                {RATE_FIELDS.map(([k, label]) => (
                  <Field key={k} label={label} required>
                    <Input name={k} inputMode="decimal" defaultValue={c?.rates[k] ?? ""} placeholder="0.0000" />
                  </Field>
                ))}
                <Field label="Effective from" required>
                  <Input name="effectiveFrom" type="date" defaultValue={c?.effectiveFrom ?? ""} />
                </Field>
                <Field label="Source" required className="sm:col-span-2">
                  <Input name="source" maxLength={300} placeholder="Contract / invoice reference" />
                </Field>
                <Field label="Reason" required className="sm:col-span-2">
                  <Input name="reason" maxLength={500} />
                </Field>
                <Field label="Your current password" required className="sm:col-span-2">
                  <PasswordInput name="currentPassword" autoComplete="current-password" maxLength={200} />
                </Field>
              </AdminForm>
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Margins {estimate ? <Badge tone="warning">estimate</Badge> : <Badge tone="outline">cost not configured</Badge>}</CardTitle>
          <CardDescription>
            Billed = charged and not refunded. Provider cost = segments handed to the provider × configured rate (a provider may bill failed submissions differently). Not reconciled with provider invoices.
          </CardDescription>
        </CardHeader>
        <RangeFilter value={range}>
          <label htmlFor="mg" className="sr-only">
            Group by
          </label>
          <NativeSelect id="mg" name="groupBy" defaultValue={groupBy} className="sm:w-40">
            {GROUPS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </NativeSelect>
        </RangeFilter>
        <div className="grid grid-cols-2 gap-4 border-b border-border p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Billed</p>
            <p className="font-semibold tabular">{formatBDT(m.totals.billed)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Failed-SMS refunds</p>
            <p className="font-semibold tabular">{formatBDT(m.totals.refunded)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Est. provider cost</p>
            <p className="font-semibold tabular">{m.totals.estimatedCost !== null ? formatBDT(m.totals.estimatedCost) : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Est. gross margin</p>
            <p className="font-semibold tabular">{m.totals.estimatedMargin !== null ? formatBDT(m.totals.estimatedMargin) : "—"}</p>
          </div>
        </div>
        <DataTable
          caption="Margins"
          rows={m.rows}
          getKey={(r) => r.key ?? "none"}
          empty={<EmptyState icon={Calculator} title="No messages in this period" />}
          columns={[
            {
              key: "label",
              header: GROUPS.find((g) => g.value === groupBy)!.label.replace("By ", ""),
              mobile: "title",
              cell: (r) => (groupBy === "organization" && r.key ? <Link href={`/admin/customers/${r.key}`} className="font-medium hover:text-primary">{r.label ?? r.key}</Link> : <span className="font-medium">{r.label ?? (groupBy === "plan" ? "Default plan" : groupBy === "campaign" ? "API / single sends" : r.key)}</span>),
            },
            { key: "messages", header: "Messages", align: "right", cell: (r) => formatNumber(r.messages) },
            { key: "billed", header: "Billed", align: "right", cell: (r) => formatBDT(r.billed) },
            { key: "refunded", header: "Refunded", align: "right", cell: (r) => <span className="text-muted-foreground">{formatBDT(r.refunded)}</span> },
            { key: "cost", header: "Est. cost", align: "right", cell: (r) => (r.estimatedCost !== null ? formatBDT(r.estimatedCost) : "—") },
            { key: "margin", header: "Est. margin", align: "right", cell: (r) => (r.estimatedMargin !== null ? formatBDT(r.estimatedMargin) : "—") },
          ]}
        />
        {m.rows.length > 0 && <Pagination page={page} pageSize={m.pageSize} total={m.total} searchParams={sp} basePath="/admin/costs" />}
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Rate change history</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border text-sm">
          {costs.history.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-2 px-5 py-2.5">
              <span>{a.actor?.name ?? "system"}</span>
              {typeof a.metadata?.reason === "string" && <span className="text-muted-foreground">“{a.metadata.reason}”</span>}
              <span className="ml-auto text-xs text-muted-foreground">{a.createdAt ? formatDateTime(a.createdAt) : ""}</span>
            </li>
          ))}
          {costs.history.length === 0 && <li className="px-5 py-4 text-muted-foreground">No changes yet.</li>}
        </ul>
      </Card>
    </>
  );
}
