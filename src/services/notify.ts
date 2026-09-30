import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Permission } from "@/lib/auth/permissions";
import { sendEmail, type EmailMessage } from "@/services/email";

/**
 * In-app + email notifications, respecting each user's preferences.
 */
export const NOTIFICATION_TYPES = {
  "campaign.completed": { label: "Campaign completed", permission: "campaigns:read", email: true },
  "campaign.failed": { label: "Campaign failed", permission: "campaigns:read", email: true },
  "campaign.review": { label: "Campaign review decisions", permission: "campaigns:read", email: true },
  "sender_id.status": { label: "Sender ID status changes", permission: "sender_ids:read", email: true },
  "payment.succeeded": { label: "Payment successful", permission: "billing:read", email: true },
  "payment.failed": { label: "Payment failed", permission: "billing:read", email: true },
  "balance.low": { label: "Low balance", permission: "billing:read", email: true },
  "api_key.created": { label: "API key created or revoked", permission: "api_keys:read", email: true },
  "support.updated": { label: "Support ticket updates", permission: "support:read", email: true },
  "team.changed": { label: "Team membership changes", permission: "team:read", email: false },
} as const satisfies Record<string, { label: string; permission: Permission; email: boolean }>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export interface NotifyInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  /** Explicit recipients; otherwise every active member with the type's permission. */
  userIds?: string[];
  /** Builds the email for a recipient; omit for in-app only. */
  email?: (to: string, name: string) => EmailMessage;
}

async function recipientsFor(organizationId: string, permission: Permission) {
  return db.organizationMember.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      role: { permissions: { some: { permission: { key: permission } } } },
    },
    select: { user: { select: { id: true, email: true, name: true, status: true } } },
  });
}

export async function notify(input: NotifyInput) {
  try {
    const def = NOTIFICATION_TYPES[input.type];
    let users: { id: string; email: string; name: string }[];
    if (input.userIds?.length) {
      users = await db.user.findMany({ where: { id: { in: input.userIds }, status: "ACTIVE" }, select: { id: true, email: true, name: true } });
    } else {
      users = (await recipientsFor(input.organizationId, def.permission)).map((m) => m.user).filter((u) => u.status === "ACTIVE");
    }
    if (!users.length) return;

    const prefs = await db.notificationPreference.findMany({ where: { userId: { in: users.map((u) => u.id) }, type: input.type } });
    const prefBy = new Map(prefs.map((p) => [p.userId, p]));

    const inApp = users.filter((u) => prefBy.get(u.id)?.inApp ?? true);
    if (inApp.length) {
      await db.notification.createMany({
        data: inApp.map((u) => ({
          organizationId: input.organizationId,
          userId: u.id,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
        })),
      });
    }
    if (input.email) {
      for (const u of users) {
        if (prefBy.get(u.id)?.email ?? def.email) await sendEmail(input.email(u.email, u.name));
      }
    }
  } catch (err) {
    // Notifications must never break the operation that triggered them.
    logger.error({ err, type: input.type }, "notification failed");
  }
}
