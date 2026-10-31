import { CheckCircle2, CircleAlert } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/misc";
import { PageHeader } from "@/components/shared/states";
import { requirePlatform } from "@/lib/auth/session";
import { laravelPage } from "@/lib/laravel-api";
import { superAdminAvailable, systemHealth } from "@/features/admin/super-admin";

export const metadata = { title: "System health" };

const LABELS: Record<string, string> = {
  database: "Database",
  cache: "Cache",
  secrets: "Required secrets present",
  appKey: "Laravel APP_KEY",
  debugOff: "Debug mode off (production)",
  smsProvider: "SMS provider configured",
  smsWebhookSecret: "SMS webhook secret (production)",
  mockPaymentsOff: "Mock payments off (production)",
  mailer: "Real mailer (production)",
  sessionDriver: "Session driver",
  scheduler: "Scheduler ran in the last 5 minutes",
  queueBacklog: "Queue backlog",
  failedJobs: "Failed jobs (24 h)",
  stuckQueuedMessages: "Messages queued > 5 min",
};

export default async function AdminSystemPage() {
  await requirePlatform("admin:health:read");
  if (!superAdminAvailable()) {
    return (
      <>
        <PageHeader title="System health" />
        <Alert tone="info" title="Needs the Laravel admin API">
          The checks run in the Laravel API (the same checks as <code>/internal/ready</code>). They appear once LARAVEL_FEATURES includes <code>admin</code>.
        </Alert>
      </>
    );
  }
  const h = await laravelPage(() => systemHealth());
  return (
    <>
      <PageHeader title="System health" description={`API checks (${h.environment}). Only ok/fail per check is shown — never hosts, versions or secret values.`} />
      <Alert tone={h.ok ? "success" : "danger"} className="mb-6" title={h.ok ? "All required checks pass" : "A required check fails"}>
        {!h.ok
          ? "Fix the failing checks before enabling more features."
          : h.environment === "production"
            ? "Production safeguards (debug off, real mailer, mock payments off, scheduler) are in place."
            : "Non-production environment: production-only safeguards are reported as ok without being enforced."}
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Checks</CardTitle>
          <CardDescription>Numbers are counts (informational, not required to be zero).</CardDescription>
        </CardHeader>
        <ul className="divide-y divide-border text-sm">
          {Object.entries(h.checks).map(([k, v]) => {
            const bad = v === "fail" || v === "high";
            return (
              <li key={k} className="flex items-center gap-3 px-5 py-2.5">
                {bad ? <CircleAlert className="size-4 text-danger" aria-hidden /> : <CheckCircle2 className="size-4 text-success" aria-hidden />}
                <span className="flex-1">{LABELS[k] ?? k}</span>
                <Badge tone={bad ? "danger" : "outline"}>{v}</Badge>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
