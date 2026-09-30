import { LayoutTemplate, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PermissionDenied } from "@/components/shared/states";
import { tenantWithPermission } from "@/lib/auth/session";
import { can } from "@/lib/auth/context";
import { calculateSegments, extractTemplateVariables } from "@/lib/sms-segments";
import { formatDate } from "@/lib/format";
import { getSmsPolicy } from "@/services/settings";
import { listTemplates } from "@/features/templates/service";
import { TemplateDialog } from "@/features/templates/components/template-dialog";
import { TemplateActions } from "@/features/templates/components/template-actions";

export const metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: PageProps<"/dashboard/templates">) {
  const sp = await searchParams;
  const { ctx, allowed } = await tenantWithPermission("templates:read");
  if (!allowed) return <PermissionDenied permission="templates:read" />;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const [templates, policy] = await Promise.all([listTemplates(ctx, q || undefined), getSmsPolicy()]);
  const canWrite = can(ctx, "templates:write");
  const canSend = can(ctx, "sms:send");
  return (
    <>
      <PageHeader title="Templates" description="Reusable messages with variables for personalisation." actions={canWrite ? <TemplateDialog rules={policy.segmentation} /> : undefined} />
      <form method="get" className="mb-4 flex max-w-md gap-2" role="search">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label htmlFor="tq" className="sr-only">
            Search templates
          </label>
          <Input id="tq" name="q" defaultValue={q} placeholder="Search templates" className="pl-9" />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {templates.length === 0 ? (
        <Card>
          <EmptyState icon={LayoutTemplate} title={q ? "No templates match" : "No templates yet"} description="Save messages you send often, such as OTPs, order updates or reminders." action={canWrite && !q ? <TemplateDialog rules={policy.segmentation} /> : undefined} />
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const seg = calculateSegments(t.body, policy.segmentation);
            const vars = extractTemplateVariables(t.body);
            return (
              <li key={t.id} className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-[15px] font-semibold">{t.name}</h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge tone={t.smsType === "PROMOTIONAL" ? "warning" : "primary"}>{t.smsType === "PROMOTIONAL" ? "Promotional" : "Transactional"}</Badge>
                      <Badge tone="neutral">
                        {seg.segments} segment{seg.segments === 1 ? "" : "s"} · {seg.encoding === "GSM7" ? "GSM-7" : "Unicode"}
                      </Badge>
                    </div>
                  </div>
                  <TemplateActions template={{ id: t.id, name: t.name, body: t.body, smsType: t.smsType }} rules={policy.segmentation} canWrite={canWrite} canSend={canSend} />
                </div>
                <p className="mt-3 line-clamp-4 flex-1 whitespace-pre-wrap rounded-md bg-surface px-3 py-2 font-bangla text-sm">{t.body}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {vars.length ? `Variables: ${vars.map((v) => `{{${v}}}`).join(", ")} · ` : ""}Updated {formatDate(t.updatedAt)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
