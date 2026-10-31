import { Flag, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/shared/states";
import { AdminActionButton, AdminForm, AdminStatusSelect } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { abusePage } from "@/features/admin/page-data";
import { laravelPage } from "@/lib/laravel-api";
import { formatDateTime } from "@/lib/format";
import { abuseStatusAction, addBlocklistAction, leadStatusAction, removeBlocklistAction } from "@/features/admin/actions";

export const metadata = { title: "Abuse & leads" };

export default async function AdminAbusePage() {
  await requirePlatform("admin:abuse:manage");
  const { reports, leads, blocklist, orgNames } = await laravelPage(() => abusePage());
  return (
    <>
      <PageHeader title="Abuse, blocklist and leads" />
      <Card>
        <CardHeader>
          <CardTitle>Abuse reports</CardTitle>
          <CardDescription>From the public report form. Matched to a customer when the sender ID is known.</CardDescription>
        </CardHeader>
        {reports.length === 0 ? (
          <EmptyState icon={Flag} title="No reports" className="py-8" />
        ) : (
          <ul className="divide-y divide-border">
            {reports.map((r) => (
              <li key={r.id} className="grid gap-2 px-5 py-4 text-sm lg:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{r.senderValue}</span>
                    {r.organizationId ? <Badge tone="primary">{orgNames.get(r.organizationId) ?? "customer"}</Badge> : <Badge tone="neutral">no matching customer</Badge>}
                    <span className="text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                  </p>
                  <p className="rounded-md bg-surface px-3 py-2 font-bangla">{r.messageContent}</p>
                  {r.description && <p className="text-muted-foreground">{r.description}</p>}
                  {(r.reporterEmail || r.reporterName) && <p className="text-xs text-muted-foreground">Reporter: {[r.reporterName, r.reporterEmail].filter(Boolean).join(", ")}</p>}
                </div>
                <AdminStatusSelect label="Report status" value={r.status} options={["NEW", "INVESTIGATING", "ACTIONED", "DISMISSED"].map((s) => ({ value: s, label: s.toLowerCase() }))} action={abuseStatusAction.bind(null, r.id)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Blocklist</CardTitle>
          <CardDescription>Numbers are never messaged; keywords and URL domains block any message containing them.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <AdminForm action={addBlocklistAction} submitLabel="Add" className="grid gap-3 sm:grid-cols-4">
            <Field label="Type">
              <NativeSelect name="type" defaultValue="KEYWORD">
                <option value="KEYWORD">Keyword / phrase</option>
                <option value="URL_DOMAIN">URL domain</option>
                <option value="NUMBER">Phone number (E.164)</option>
              </NativeSelect>
            </Field>
            <Field label="Value">
              <Input name="value" />
            </Field>
            <Field label="Reason" className="sm:col-span-2">
              <Input name="reason" />
            </Field>
          </AdminForm>
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {blocklist.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <Badge tone="outline">{b.type.toLowerCase().replace("_", " ")}</Badge>
                <span className="font-mono">{b.value}</span>
                <span className="text-muted-foreground">{b.reason}</span>
                <span className="ml-auto">
                  <AdminActionButton action={removeBlocklistAction.bind(null, b.id)} label="Remove" variant="ghost" />
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card id="leads" className="mt-6 scroll-mt-24">
        <CardHeader>
          <CardTitle>Sales leads</CardTitle>
          <CardDescription>Submissions from the public contact form.</CardDescription>
        </CardHeader>
        {leads.length === 0 ? (
          <EmptyState icon={Users} title="No leads yet" className="py-8" />
        ) : (
          <ul className="divide-y divide-border">
            {leads.map((l) => (
              <li key={l.id} className="grid gap-2 px-5 py-4 text-sm lg:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <p className="font-medium">
                    {l.subject} <span className="font-normal text-muted-foreground">· {formatDateTime(l.createdAt)}</span>
                  </p>
                  <p className="text-muted-foreground">
                    {l.name}
                    {l.company ? `, ${l.company}` : ""} · <a href={`mailto:${l.email}`} className="text-primary hover:underline">{l.email}</a>
                    {l.phone ? ` · ${l.phone}` : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{l.message}</p>
                </div>
                <AdminStatusSelect label="Lead status" value={l.status} options={["NEW", "CONTACTED", "CLOSED"].map((s) => ({ value: s, label: s.toLowerCase() }))} action={leadStatusAction.bind(null, l.id)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
