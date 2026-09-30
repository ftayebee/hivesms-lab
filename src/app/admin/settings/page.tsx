import { CheckCircle2, CircleDashed } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/shared/states";
import { AdminForm } from "@/components/admin/admin-ui";
import { requirePlatform } from "@/lib/auth/session";
import { siteConfig } from "@/config/site";
import { getPaymentSettings, getSiteContent, getSmsPolicy, getSmsProviderSettings, listSecretStatus } from "@/services/settings";
import { saveSiteContentAction, savePaymentSettingsAction, saveSmsPolicyAction, saveSmsProviderAction } from "@/features/admin/actions";

export const metadata = { title: "Settings" };

function SecretState({ set }: { set: boolean }) {
  return set ? (
    <span className="inline-flex items-center gap-1 text-xs text-success">
      <CheckCircle2 className="size-3.5" aria-hidden /> stored (encrypted)
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleDashed className="size-3.5" aria-hidden /> not set (env fallback)
    </span>
  );
}

function Check({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={checked} className="size-4 accent-[var(--primary)]" /> {label}
    </label>
  );
}

export default async function AdminSettingsPage() {
  await requirePlatform("admin:settings:manage");
  const [provider, secrets, policy, payments, site] = await Promise.all([getSmsProviderSettings(), listSecretStatus(), getSmsPolicy(), getPaymentSettings(), getSiteContent()]);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return (
    <>
      <PageHeader title="Settings" description="Platform configuration. Secret values are encrypted at rest and never shown again after saving." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>SMS provider</CardTitle>
            <CardDescription>
              Delivery reports: <code className="font-mono">{base}/api/v1/webhooks/sms/{provider.provider}</code> · inbound: <code className="font-mono">…/{provider.provider}/inbound</code>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {provider.provider === "mock" && <Alert tone="warning">The mock provider is active: no real SMS is sent. Connect a licensed provider before going live.</Alert>}
            {provider.provider === "http" && <Alert tone="info">The generic HTTP adapter must be reviewed against your provider&apos;s API documentation before production use (see docs/05-integrations.md).</Alert>}
            <AdminForm action={saveSmsProviderAction} submitLabel="Save provider" className="grid gap-4 sm:grid-cols-2">
              <Field label="Provider">
                <NativeSelect name="provider" defaultValue={provider.provider}>
                  <option value="mock">Mock (simulation)</option>
                  <option value="http">Generic HTTP gateway</option>
                </NativeSelect>
              </Field>
              <Field label="Endpoint URL">
                <Input name="url" defaultValue={provider.url} placeholder="https://provider.example/api/send" />
              </Field>
              <Field label="API key" labelAction={<SecretState set={secrets["sms.provider.apiKey"]} />} hint="Leave blank to keep the stored value.">
                <Input name="apiKey" type="password" autoComplete="off" />
              </Field>
              <Field label="API secret" labelAction={<SecretState set={secrets["sms.provider.apiSecret"]} />} hint="Leave blank to keep the stored value.">
                <Input name="apiSecret" type="password" autoComplete="off" />
              </Field>
              <Field label="Webhook signing secret" labelAction={<SecretState set={secrets["sms.provider.webhookSecret"]} />} hint="Used to verify delivery-report webhooks.">
                <Input name="webhookSecret" type="password" autoComplete="off" />
              </Field>
              <div className="self-end pb-2">
                <Check name="clearSecrets" label="Clear all stored provider secrets" checked={false} />
              </div>
              <fieldset className="grid gap-3 rounded-md border border-border p-3 sm:col-span-2 sm:grid-cols-4">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Parameter names (HTTP adapter)</legend>
                <Field label="Recipient">
                  <Input name="mapTo" defaultValue={provider.mapping?.to ?? ""} placeholder="to" />
                </Field>
                <Field label="Message">
                  <Input name="mapMessage" defaultValue={provider.mapping?.message ?? ""} placeholder="msg" />
                </Field>
                <Field label="Sender ID">
                  <Input name="mapSenderId" defaultValue={provider.mapping?.senderId ?? ""} placeholder="sender_id" />
                </Field>
                <Field label="API key">
                  <Input name="mapApiKey" defaultValue={provider.mapping?.apiKey ?? ""} placeholder="api_key" />
                </Field>
              </fieldset>
            </AdminForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SMS policy</CardTitle>
            <CardDescription>Segment limits depend on the provider. Configure promotional rules to match current regulations and operator terms.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminForm action={saveSmsPolicyAction} submitLabel="Save policy" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="GSM-7 single segment">
                <Input name="gsmSingle" type="number" defaultValue={policy.segmentation.gsm7.single} />
              </Field>
              <Field label="GSM-7 per segment (long)">
                <Input name="gsmMulti" type="number" defaultValue={policy.segmentation.gsm7.multipart} />
              </Field>
              <Field label="Unicode single segment">
                <Input name="ucsSingle" type="number" defaultValue={policy.segmentation.ucs2.single} />
              </Field>
              <Field label="Unicode per segment (long)">
                <Input name="ucsMulti" type="number" defaultValue={policy.segmentation.ucs2.multipart} />
              </Field>
              <Field label="Max segments per message">
                <Input name="maxSegments" type="number" defaultValue={policy.segmentation.maxSegments} />
              </Field>
              <Field label="Review campaigns above (recipients)">
                <Input name="reviewThresholdRecipients" type="number" defaultValue={policy.reviewThresholdRecipients} />
              </Field>
              <Field label="Quiet hours start (0-23, Asia/Dhaka)">
                <Input name="quietStart" type="number" min={0} max={23} defaultValue={policy.promotionalQuietHours?.start ?? 21} />
              </Field>
              <Field label="Quiet hours end">
                <Input name="quietEnd" type="number" min={0} max={23} defaultValue={policy.promotionalQuietHours?.end ?? 9} />
              </Field>
              <Field label="Opt-out text" className="sm:col-span-2">
                <Input name="promotionalOptOutText" defaultValue={policy.promotionalOptOutText} />
              </Field>
              <Field label="Opt-out keywords" className="sm:col-span-2">
                <Input name="optOutKeywords" defaultValue={policy.optOutKeywords.join(", ")} />
              </Field>
              <div className="flex flex-wrap gap-x-5 gap-y-2 sm:col-span-2 lg:col-span-4">
                <Check name="quietHoursEnabled" label="Enforce promotional quiet hours" checked={Boolean(policy.promotionalQuietHours)} />
                <Check name="refundFailedMessages" label="Refund messages the provider reports as failed" checked={policy.refundFailedMessages} />
                <Check name="appendOptOutText" label="Append opt-out text to promotional campaigns" checked={policy.appendOptOutText} />
              </div>
            </AdminForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              SSLCommerz IPN URL: <code className="font-mono">{base}/api/v1/webhooks/payments/sslcommerz</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AdminForm action={savePaymentSettingsAction} submitLabel="Save payments" className="grid gap-4 sm:grid-cols-2">
              <fieldset className="sm:col-span-2">
                <legend className="text-sm font-medium">Enabled methods</legend>
                <div className="mt-2 flex flex-wrap gap-5">
                  {[
                    ["mock", "Test payment (development only)"],
                    ["manual", "Bank transfer / manual"],
                    ["sslcommerz", "SSLCommerz (unverified adapter)"],
                  ].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="enabled" value={k} defaultChecked={payments.enabled.includes(k)} className="size-4 accent-[var(--primary)]" /> {l}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field label="Manual payment instructions" className="sm:col-span-2" hint="Shown to customers who choose bank transfer. Include your account details.">
                <Textarea name="manualInstructions" rows={4} defaultValue={payments.manualInstructions} />
              </Field>
              <Field label="SSLCommerz store ID">
                <Input name="sslStoreId" defaultValue={payments.sslcommerz.storeId} />
              </Field>
              <Field label="SSLCommerz store password" labelAction={<SecretState set={secrets["payments.sslcommerz.storePassword"]} />} hint="Leave blank to keep the stored value.">
                <Input name="sslStorePassword" type="password" autoComplete="off" />
              </Field>
              <div className="flex flex-wrap gap-5 sm:col-span-2">
                <Check name="sslLive" label="SSLCommerz live mode (off = sandbox)" checked={payments.sslcommerz.live} />
                <Check name="clearSslPassword" label="Clear stored SSLCommerz password" checked={false} />
              </div>
            </AdminForm>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Website content</CardTitle>
            <CardDescription>Overrides the placeholder contact details from src/config/site.ts. Leave a field blank to use the configured default.</CardDescription>
          </CardHeader>
          <CardContent>
            <AdminForm action={saveSiteContentAction} submitLabel="Save content" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["email", "General email"],
                  ["supportEmail", "Support email"],
                  ["salesEmail", "Sales email"],
                  ["abuseEmail", "Abuse email"],
                  ["phone", "Phone"],
                  ["hours", "Support hours"],
                ] as const
              ).map(([k, l]) => (
                <Field key={k} label={l}>
                  <Input name={k} defaultValue={site.contact[k] ?? ""} placeholder={siteConfig.contact[k]} />
                </Field>
              ))}
              <Field label="Address" className="sm:col-span-2 lg:col-span-3">
                <Input name="address" defaultValue={site.contact.address ?? ""} placeholder={siteConfig.contact.address} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <Check name="announcementEnabled" label="Show announcement banner" checked={site.announcement.enabled} />
              </div>
              <Field label="Announcement text" className="sm:col-span-2">
                <Input name="announcementText" defaultValue={site.announcement.text} maxLength={200} />
              </Field>
              <Field label="Announcement link">
                <Input name="announcementHref" defaultValue={site.announcement.href ?? ""} />
              </Field>
            </AdminForm>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
