import { notFound } from "next/navigation";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { Alert } from "@/components/ui/misc";
import { tenantWithPermission } from "@/lib/auth/session";
import { laravelData, laravelPage } from "@/lib/laravel-api";
import { laravelEnabled } from "@/lib/laravel/flags";
import type { SegmentationRules } from "@/lib/sms-segments";
import { approvedSenderIds } from "@/features/sender-ids/service";
import { DynamicComposer } from "@/features/dynamic-sms/components/dynamic-composer";

export const metadata = { title: "Dynamic SMS" };

interface ComposerConfig {
  segmentation: SegmentationRules;
  balance: string;
  batching?: { default: number; allowed: number[] };
}

/** Dynamic SMS: one personalised message per CSV row (docs/20). Laravel only, opt-in flag `dynamicSms`. */
export default async function DynamicSmsPage() {
  if (!laravelEnabled("dynamicSms")) notFound();
  const { ctx, session, allowed } = await tenantWithPermission(["sms:send", "campaigns:write"]);
  if (!allowed) return <PermissionDenied permission="sms:send + campaigns:write" />;

  const [config, senders] = await laravelPage(() => Promise.all([laravelData<ComposerConfig>("app/sms/composer"), approvedSenderIds(ctx.organizationId)]));
  const platformSender = process.env.SMS_DEFAULT_SENDER_ID ?? "";
  const options = [
    ...senders.map((s) => ({ value: s.value, isDefault: s.isDefault, label: `${s.value} (${s.type === "MASKING" ? "masking" : "number"})${s.isDefault ? " · default" : ""}` })),
    ...(senders.some((s) => s.isDefault) ? [] : [{ value: "", isDefault: true, label: `Shared number ${platformSender}` }]),
  ];
  const batching = config.batching ?? { default: 100, allowed: [10, 100] };

  return (
    <>
      <PageHeader title="Dynamic SMS" description="Upload a CSV, map its columns and send every row its own personalised message." />
      {!session.user.emailVerifiedAt && (
        <Alert tone="warning" className="mb-6">
          Verify your email address to send messages. You can still upload and preview.
        </Alert>
      )}
      <DynamicComposer senders={options} rules={config.segmentation} balance={Number(config.balance)} batchSizes={batching.allowed} defaultBatchSize={batching.default} maxRows={50_000} />
    </>
  );
}
