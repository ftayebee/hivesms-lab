import Link from "next/link";
import { ArrowRight, Gauge, KeyRound, RotateCcw, ShieldCheck, FileJson } from "lucide-react";
import { Container, CtaBand, FeatureGrid, JsonLd, Section, SectionHeading } from "@/components/marketing/blocks";
import { ApiCodeBlock } from "@/components/docs/code-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { balanceSamples, bulkSmsSamples, errorResponseJson, sendSmsRequestJson, sendSmsResponseJson, sendSmsSamples, statusSamples, webhookPayloadJson, webhookVerifySamples } from "@/content/api-samples";
import { errorCodeList, publicEndpoints } from "@/content/api-reference";
import { siteConfig } from "@/config/site";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "SMS API for developers",
  description: "REST SMS API for Bangladesh: Bearer API keys, send and bulk endpoints, delivery reports, balance, signed webhooks, idempotency and rate limits. Examples in cURL, JavaScript, PHP and Python.",
  path: "/sms-api",
});

function MethodBadge({ method }: { method: string }) {
  return <Badge tone={method === "GET" ? "accent" : "primary"} className="font-mono">{method}</Badge>;
}

export default function SmsApiPage() {
  return (
    <>
      <JsonLd data={breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "SMS API", path: "/sms-api" }])} />
      <section className="relative overflow-hidden border-b border-border bg-code text-code-foreground">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_85%_10%,rgb(44_199_184/0.18),transparent_70%)]" />
        <Container className="relative grid gap-12 py-16 md:py-20 lg:grid-cols-[1fr_1.1fr] lg:items-center [&>*]:min-w-0">
          <div>
            <p className="mb-4 text-sm font-semibold text-[#2cc7b8]">SMS API v1</p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">An SMS API that behaves the way you expect</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-code-foreground/75">JSON over HTTPS, Bearer API keys, idempotent sends, signed webhooks and consistent errors. Integrate from any language in an afternoon.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-white text-[#0e1a36] hover:bg-white/90">
                <Link href="/register">Get an API key</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/25 text-code-foreground hover:bg-white/10">
                <Link href="/docs">Read the documentation</Link>
              </Button>
            </div>
          </div>
          <ApiCodeBlock samples={sendSmsSamples} title="Send SMS" className="border-white/10" />
        </Container>
      </section>

      <Section labelledBy="overview-h">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <SectionHeading id="overview-h" title="REST API overview" />
            <dl className="mt-8 space-y-4 text-sm">
              {[
                ["Base URL", siteConfig.apiBaseUrl],
                ["Format", "JSON request and response bodies, UTF-8"],
                ["Authentication", "Authorization: Bearer <api key>"],
                ["Versioning", "Path-based (/api/v1). Breaking changes only ship in a new version."],
                ["Numbers", "Bangladesh mobile numbers in any common format; returned as +8801XXXXXXXXX"],
                ["Time", "ISO 8601 timestamps in UTC; the dashboard displays Asia/Dhaka"],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                  <dt className="font-medium">{k}</dt>
                  <dd className="break-all font-mono text-[13px] text-muted-foreground">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">API endpoints</caption>
              <thead className="bg-surface">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Endpoint</th>
                  <th scope="col" className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground sm:table-cell">Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {publicEndpoints.map((e) => (
                  <tr key={e.path + e.method}>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <MethodBadge method={e.method} />
                        <Link href={`/docs/api-reference#${e.anchor}`} className="font-mono text-[13px] hover:text-primary hover:underline">
                          {e.path}
                        </Link>
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">{e.summary}</p>
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell">{e.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Alert tone="info" className="mt-10" title="About delivery in this environment">
          These endpoints are implemented and processed by this platform. Actual delivery to handsets happens only once the platform operator connects an upstream SMS provider; development and sandbox environments run a mock provider that simulates delivery results.
        </Alert>
      </Section>

      <Section tone="surface" labelledBy="auth-h">
        <div className="grid gap-12 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <SectionHeading id="auth-h" title="Authentication and API keys" description="Create keys in Dashboard → API. Each key belongs to one organization and carries only the scopes you grant." />
            <ul className="mt-8 space-y-4 text-sm">
              {[
                "Keys look like sfk_live_xxxxxxxx_… and are shown exactly once when created. Store them in a secret manager.",
                "We store only a keyed hash of the key, so we can't show it again. Lost keys are revoked and replaced.",
                "Restrict a key to your server's IP addresses and set an expiry for temporary integrations.",
                "Never put an API key in a mobile app, browser JavaScript or a public repository.",
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <KeyRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span className="leading-relaxed">{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-4">
            <ApiCodeBlock samples={[sendSmsRequestJson]} title="POST /api/v1/sms/send" />
            <ApiCodeBlock samples={[sendSmsResponseJson, errorResponseJson]} />
          </div>
        </div>
      </Section>

      <Section labelledBy="endpoints-h">
        <SectionHeading id="endpoints-h" title="Bulk sending, status and balance" description="The bulk endpoint accepts per-recipient variables. Status lookups include the full event history." />
        <div className="mt-10 grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <h3 className="mb-3 text-sm font-semibold">Bulk SMS</h3>
            <ApiCodeBlock samples={bulkSmsSamples} />
          </div>
          <div className="space-y-6">
            <div>
              <h3 className="mb-3 text-sm font-semibold">Delivery report</h3>
              <ApiCodeBlock samples={statusSamples} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold">Balance</h3>
              <ApiCodeBlock samples={balanceSamples} />
            </div>
          </div>
        </div>
      </Section>

      <Section tone="surface" labelledBy="webhooks-h">
        <div className="grid gap-12 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <SectionHeading id="webhooks-h" title="Webhooks" description="Register an HTTPS endpoint in Dashboard → API → Webhooks and choose events: message.delivered, message.failed, campaign.completed." />
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li>Each request has an X-SMSFlow-Signature header: t=timestamp,v1=HMAC-SHA256(secret, &quot;t.body&quot;).</li>
              <li>Respond with any 2xx within 10 seconds. Failed deliveries retry with exponential backoff, up to 8 attempts.</li>
              <li>Deliveries can repeat; deduplicate with the payload id.</li>
            </ul>
            <ApiCodeBlock samples={[webhookPayloadJson]} className="mt-6" />
          </div>
          <div>
            <h3 className="mb-3 text-sm font-semibold">Verify the signature</h3>
            <ApiCodeBlock samples={webhookVerifySamples} />
          </div>
        </div>
      </Section>

      <Section labelledBy="limits-h">
        <SectionHeading id="limits-h" title="Rate limits, retries and errors" />
        <div className="mt-10">
          <FeatureGrid
            columns={4}
            items={[
              { icon: Gauge, title: "Rate limits", body: "Default 600 requests/minute per key, 120/minute for send endpoints. See X-RateLimit-* headers." },
              { icon: RotateCcw, title: "Idempotency", body: "Idempotency-Key header on POST /sms/*: replays within 24 hours return the original response." },
              { icon: FileJson, title: "Consistent errors", body: "Every error has a stable code, a readable message and a request ID for support." },
              { icon: ShieldCheck, title: "Account limits", body: "Daily and monthly send limits protect you from runaway loops. Ask support to raise them." },
            ]}
          />
        </div>
        <div className="mt-10 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Error codes</caption>
            <thead className="bg-surface">
              <tr>
                <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Code</th>
                <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">HTTP</th>
                <th scope="col" className="hidden px-4 py-2.5 text-left text-xs font-medium text-muted-foreground md:table-cell">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {errorCodeList
                .filter((e) => !["UNAUTHORIZED", "EMAIL_NOT_VERIFIED", "PAYMENT_FAILED", "FEATURE_DISABLED"].includes(e.code))
                .slice(0, 12)
                .map((e) => (
                  <tr key={e.code}>
                    <td className="px-4 py-2.5 font-mono text-[13px]">
                      {e.code}
                      <p className="mt-1 font-sans text-xs text-muted-foreground md:hidden">{e.description}</p>
                    </td>
                    <td className="px-4 py-2.5 tabular text-muted-foreground">{e.status}</td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{e.description}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Button asChild variant="link" className="mt-4">
          <Link href="/docs/error-codes">
            All error codes <ArrowRight />
          </Link>
        </Button>
      </Section>

      <CtaBand title="Build with the SMS API" description="Create an account, generate a scoped key, and follow the quick start." primary={{ label: "Get an API key", href: "/register" }} secondary={{ label: "Quick start", href: "/docs/quick-start" }} />
    </>
  );
}
