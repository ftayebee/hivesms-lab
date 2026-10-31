"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { logger } from "@/lib/logger";
import { launchCampaign } from "@/services/messaging/campaign-runner";
import { adminAction } from "./guard";
import {
  adjustWallet,
  orgControlsSchema,
  reviewCampaign,
  reviewManualPayment,
  reviewSenderId,
  setAbuseStatus,
  setLeadStatus,
  setOrganizationStatus,
  setTicketStatus,
  staffReply,
  staffReplySchema,
  updateOrganizationControls,
  updateUserAccess,
  walletAdjustSchema,
} from "./service";
import {
  addBlocklist,
  billingPolicySchema,
  blocklistSchema,
  packageSchema,
  paymentSettingsSchema,
  planSchema,
  removeBlocklist,
  saveBillingPolicy,
  savePackage,
  savePaymentSettings,
  savePlan,
  saveSiteContent,
  saveSmsPolicy,
  saveSmsProvider,
  siteContentSchema,
  smsPolicySchema,
  smsProviderSchema,
} from "./config";
import { inviteStaff, providerCostSchema, refundPayment, saveProviderCosts, sendPasswordReset, staffInviteSchema } from "./super-admin";

const uuid = z.uuid();
const reasonText = z.string().trim().max(500).optional().transform((v) => v || null);
const ok = (message: string, path?: string): ActionResult => {
  revalidatePath(path ?? "/admin", "layout");
  return { ok: true, message };
};

// ─── Customers ───

export async function updateOrgControlsAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:customers:manage", async (a) => {
    await updateOrganizationControls(a, uuid.parse(raw.id), orgControlsSchema.parse(raw));
    return ok("Account controls saved.");
  }, raw);
}

export async function setOrgStatusAction(id: string, status: "ACTIVE" | "SUSPENDED", reason?: string): Promise<ActionResult> {
  return adminAction("admin:customers:manage", async (a) => {
    await setOrganizationStatus(a, uuid.parse(id), z.enum(["ACTIVE", "SUSPENDED"]).parse(status), reasonText.parse(reason));
    return ok(status === "SUSPENDED" ? "Account suspended." : "Account reactivated.");
  });
}

export async function adjustWalletAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:wallet:adjust", async (a) => {
    const r = await adjustWallet(a, uuid.parse(raw.orgId), walletAdjustSchema.parse(raw));
    return ok(r.replayed ? "This adjustment was already applied (not repeated)." : "Wallet adjusted.");
  }, raw);
}

// ─── Reviews ───

export async function reviewCampaignAction(id: string, decision: "approve" | "reject", reason?: string): Promise<ActionResult> {
  return adminAction("admin:campaigns:review", async (a) => {
    const cid = uuid.parse(id);
    const r = await reviewCampaign(a, cid, z.enum(["approve", "reject"]).parse(decision), reasonText.parse(reason));
    if (r.launchNow) {
      after(async () => {
        try {
          await launchCampaign(cid);
        } catch (err) {
          logger.error({ err, cid }, "launch after approval failed");
        }
      });
    }
    return ok(decision === "approve" ? "Campaign approved." : "Campaign rejected.");
  });
}

export async function reviewSenderIdAction(id: string, decision: "APPROVED" | "REJECTED" | "SUSPENDED", reason?: string, providerRef?: string): Promise<ActionResult> {
  return adminAction("admin:sender_ids:review", async (a) => {
    await reviewSenderId(a, uuid.parse(id), z.enum(["APPROVED", "REJECTED", "SUSPENDED"]).parse(decision), reasonText.parse(reason), reasonText.parse(providerRef));
    return ok(`Sender ID ${decision.toLowerCase()}.`);
  });
}

export async function reviewPaymentAction(id: string, decision: "approve" | "reject", reason?: string): Promise<ActionResult> {
  return adminAction("admin:billing:manage", async (a) => {
    await reviewManualPayment(a, uuid.parse(id), z.enum(["approve", "reject"]).parse(decision), reasonText.parse(reason));
    return ok(decision === "approve" ? "Payment verified and balance added." : "Payment rejected.");
  });
}

// ─── Support ───

export async function staffReplyAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:support", async (a) => {
    const id = uuid.parse(raw.id);
    await staffReply(a, id, staffReplySchema.parse(raw));
    return ok(raw.internal ? "Internal note added." : "Reply sent to the customer.", `/admin/support/${id}`);
  }, raw);
}

export async function ticketStatusAction(id: string, status: string, assignToMe = false): Promise<ActionResult> {
  return adminAction("admin:support", async (a) => {
    await setTicketStatus(a, uuid.parse(id), z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"]).parse(status), assignToMe);
    return ok("Ticket updated.");
  });
}

// ─── Users, abuse, leads ───

const privileged = {
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters).").max(500),
  currentPassword: z.string().min(1, "Confirm with your current password.").max(200),
};

export async function updateUserAccessAction(userId: string, input: { platformRole?: string; status?: string }, reason?: string, currentPassword?: string): Promise<ActionResult> {
  return adminAction("admin:users:manage", async (a) => {
    const parsed = z
      .object({ platformRole: z.enum(["USER", "SUPPORT", "ADMIN", "SUPER_ADMIN"]).optional(), status: z.enum(["ACTIVE", "SUSPENDED"]).optional(), ...privileged })
      .parse({ ...input, reason, currentPassword });
    await updateUserAccess(a, uuid.parse(userId), parsed);
    return ok("Access updated. Their sessions were signed out.");
  });
}

// ─── Super Admin (Laravel only; docs/18) ───

export async function inviteStaffAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:users:manage", async () => {
    const r = await inviteStaff(staffInviteSchema.parse(raw));
    return ok(r.message, "/admin/users");
  }, raw);
}

export async function sendPasswordResetAction(userId: string, reason?: string): Promise<ActionResult> {
  return adminAction("admin:customers:manage", async () => {
    await sendPasswordReset(uuid.parse(userId), reasonText.parse(reason));
    return ok("A password-reset link was e-mailed to the account owner.");
  });
}

export async function refundPaymentAction(id: string, reason?: string, currentPassword?: string): Promise<ActionResult> {
  return adminAction("admin:payments:refund", async () => {
    const p = z.object(privileged).parse({ reason, currentPassword });
    await refundPayment(uuid.parse(id), p.reason, p.currentPassword);
    return ok("Payment marked refunded and the credit removed from the wallet.", "/admin/payments");
  });
}

export async function saveProviderCostsAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:costs:manage", async () => {
    await saveProviderCosts(providerCostSchema.parse(raw));
    return ok("Provider costs saved. Margin figures are estimates based on these rates.", "/admin/costs");
  }, raw);
}

export async function abuseStatusAction(id: string, status: string, note?: string): Promise<ActionResult> {
  return adminAction("admin:abuse:manage", async (a) => {
    await setAbuseStatus(a, uuid.parse(id), z.enum(["NEW", "INVESTIGATING", "ACTIONED", "DISMISSED"]).parse(status), reasonText.parse(note));
    return ok("Report updated.");
  });
}

export async function leadStatusAction(id: string, status: string): Promise<ActionResult> {
  return adminAction("admin:customers:read", async (a) => {
    await setLeadStatus(a, uuid.parse(id), z.enum(["NEW", "CONTACTED", "CLOSED"]).parse(status));
    return ok("Lead updated.");
  });
}

// ─── Configuration ───

export async function savePlanAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:pricing:manage", async (a) => {
    await savePlan(a, planSchema.parse(raw), typeof raw.id === "string" && raw.id ? uuid.parse(raw.id) : undefined);
    revalidatePath("/pricing");
    return ok("Plan saved. The public pricing page updates within 5 minutes.");
  }, raw);
}

export async function savePackageAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:pricing:manage", async (a) => {
    await savePackage(a, packageSchema.parse(raw), typeof raw.id === "string" && raw.id ? uuid.parse(raw.id) : undefined);
    return ok("Package saved.");
  }, raw);
}

export async function saveBillingPolicyAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:pricing:manage", async (a) => {
    await saveBillingPolicy(a, billingPolicySchema.parse(raw));
    revalidatePath("/pricing");
    return ok("Billing policy saved.");
  }, raw);
}

export async function saveSmsPolicyAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:settings:manage", async (a) => {
    await saveSmsPolicy(a, smsPolicySchema.parse(raw));
    return ok("SMS policy saved.");
  }, raw);
}

export async function saveSmsProviderAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  const safeRaw = { ...raw, apiKey: "", apiSecret: "", webhookSecret: "" };
  return adminAction("admin:settings:manage", async (a) => {
    await saveSmsProvider(a, smsProviderSchema.parse(raw));
    return ok("SMS provider settings saved.");
  }, safeRaw);
}

export async function savePaymentSettingsAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:settings:manage", async (a) => {
    await savePaymentSettings(a, paymentSettingsSchema.parse(raw));
    return ok("Payment settings saved.");
  }, { ...raw, sslStorePassword: "" });
}

export async function saveSiteContentAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:settings:manage", async (a) => {
    await saveSiteContent(a, siteContentSchema.parse(raw));
    revalidatePath("/contact");
    return ok("Website content saved.");
  }, raw);
}

export async function addBlocklistAction(_p: unknown, fd: FormData): Promise<ActionResult> {
  const raw = formToObject(fd);
  return adminAction("admin:abuse:manage", async (a) => {
    await addBlocklist(a, blocklistSchema.parse(raw));
    return ok("Added to blocklist.");
  }, raw);
}

export async function removeBlocklistAction(id: string): Promise<ActionResult> {
  return adminAction("admin:abuse:manage", async (a) => {
    await removeBlocklist(a, uuid.parse(id));
    return ok("Removed from blocklist.");
  });
}
