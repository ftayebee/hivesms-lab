import Link from "next/link";
import { PageHeader, PermissionDenied } from "@/components/shared/states";
import { Alert } from "@/components/ui/misc";
import { SmsComposer, type ComposerSender } from "@/components/dashboard/sms-composer";
import { tenantWithPermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSmsPolicy } from "@/services/settings";
import { getOrganizationPlan } from "@/services/billing/pricing";
import { getBalance } from "@/services/billing/wallet";
import { listGroups } from "@/features/contacts/service";
import { approvedSenderIds } from "@/features/sender-ids/service";

export const metadata = { title: "Send SMS" };

export default async function SendPage({ searchParams }: PageProps<"/dashboard/send">) {
  const sp = await searchParams;
  const { ctx, session, allowed } = await tenantWithPermission(["sms:send", "campaigns:write"]);
  if (!allowed) return <PermissionDenied permission="sms:send + campaigns:write" />;

  const [policy, plan, balance, groups, senders, templates] = await Promise.all([
    getSmsPolicy(),
    getOrganizationPlan(ctx.organizationId),
    getBalance(ctx.organizationId),
    ctx.permissions.includes("contacts:read") ? listGroups(ctx) : Promise.resolve([]),
    approvedSenderIds(ctx.organizationId),
    db.template.findMany({ where: { organizationId: ctx.organizationId, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, body: true, smsType: true } }),
  ]);

  // Pre-fill from a draft or a template.
  const draftId = typeof sp.draft === "string" ? sp.draft : null;
  const templateId = typeof sp.template === "string" ? sp.template : null;
  let initial: React.ComponentProps<typeof SmsComposer>["initial"];
  if (draftId) {
    const d = await db.campaign.findFirst({ where: { id: draftId, organizationId: ctx.organizationId, status: "DRAFT", deletedAt: null } });
    if (d) {
      const aud = d.audience as { groupIds?: string[]; numbers?: string[] };
      initial = {
        id: d.id,
        name: d.name,
        smsType: d.smsType,
        senderId: senders.some((s) => s.value === d.senderValue) ? d.senderValue : "",
        templateId: d.templateId ?? undefined,
        message: d.message,
        groupIds: aud.groupIds ?? [],
        numbers: (aud.numbers ?? []).join("\n"),
        scheduledAt: d.scheduledAt?.toISOString() ?? null,
      };
    }
  } else if (templateId) {
    const t = templates.find((x) => x.id === templateId);
    if (t) initial = { templateId: t.id, message: t.body, smsType: t.smsType };
  }

  const platformSender = process.env.SMS_DEFAULT_SENDER_ID ?? "";
  const composerSenders: ComposerSender[] = [
    ...senders.map((s) => ({ value: s.value, type: s.type, isDefault: s.isDefault, label: `${s.value} (${s.type === "MASKING" ? "masking" : "number"})${s.isDefault ? " · default" : ""}` })),
    ...(senders.some((s) => s.isDefault) ? [] : [{ value: "", type: "NON_MASKING" as const, isDefault: true, label: `Shared number ${platformSender}` }]),
  ];

  return (
    <>
      <PageHeader
        title={initial?.id ? "Edit draft" : "Send SMS"}
        description="Compose once, send to numbers or contact groups, now or on schedule."
        back={initial?.id ? { href: "/dashboard/campaigns", label: "Campaigns" } : undefined}
      />
      {!session.user.emailVerifiedAt && (
        <Alert tone="warning" className="mb-6">
          Verify your email address to send messages. You can still prepare and save drafts.
        </Alert>
      )}
      {balance.lte(0) && (
        <Alert tone="warning" className="mb-6" title="Your wallet is empty">
          <Link href="/dashboard/wallet" className="font-medium text-primary hover:underline">
            Add balance
          </Link>{" "}
          before sending.
        </Alert>
      )}
      <SmsComposer
        senders={composerSenders}
        groups={groups.map((g) => ({ id: g.id, name: g.name, count: g.count }))}
        templates={templates}
        rules={policy.segmentation}
        rates={{
          transactionalMasking: Number(plan.transactionalMasking),
          transactionalNonMasking: Number(plan.transactionalNonMasking),
          promotionalMasking: Number(plan.promotionalMasking),
          promotionalNonMasking: Number(plan.promotionalNonMasking),
        }}
        balance={balance.toNumber()}
        quietHours={policy.promotionalQuietHours}
        optOutHint={policy.promotionalOptOutText}
        initial={initial}
      />
    </>
  );
}
