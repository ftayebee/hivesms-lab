"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formToObject, type ActionResult } from "@/lib/action-result";
import { tenantAction } from "@/lib/tenant-action";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { launchCampaign } from "@/services/messaging/campaign-runner";
import { dispatchNow } from "@/services/messaging/dispatcher";
import { composerSchema } from "./schemas";
import {
  cancelCampaign,
  deleteDraft,
  duplicateCampaign,
  estimateComposer,
  pauseCampaign,
  resumeCampaign,
  saveDraft,
  submitCampaign,
  type CampaignEstimate,
} from "./service";

/** Launches an immediate campaign after the response is sent; small sends dispatch inline too. */
function launchInBackground(campaignId: string) {
  after(async () => {
    try {
      const r = await launchCampaign(campaignId);
      if (r.launched && r.messages <= 200) {
        const ids = await db.message.findMany({ where: { campaignId, status: "QUEUED" }, select: { id: true } });
        await dispatchNow(ids.map((m) => m.id));
      }
    } catch (err) {
      logger.error({ err, campaignId }, "background launch failed; worker will retry");
    }
  });
}

export async function saveDraftAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const raw = formToObject(formData);
  return tenantAction<{ id: string }>(
    "campaigns:write",
    async (ctx) => {
      const c = await saveDraft(ctx, composerSchema.parse(raw));
      revalidatePath("/dashboard/campaigns");
      return { ok: true, message: "Draft saved.", data: { id: c.id } };
    },
    { raw },
  );
}

export async function estimateAction(formData: FormData): Promise<ActionResult<CampaignEstimate>> {
  const raw = formToObject(formData);
  return tenantAction<CampaignEstimate>(
    ["campaigns:write", "sms:send"],
    async (ctx) => ({ ok: true, data: await estimateComposer(ctx, composerSchema.parse(raw)) }),
    { raw, requireVerifiedEmail: true },
  );
}

export async function submitAction(formData: FormData): Promise<ActionResult<{ id: string; status: string }>> {
  const raw = formToObject(formData);
  return tenantAction<{ id: string; status: string }>(
    ["campaigns:write", "sms:send"],
    async (ctx) => {
      const { campaign, launchNow } = await submitCampaign(ctx, composerSchema.parse(raw));
      if (launchNow) launchInBackground(campaign.id);
      revalidatePath("/dashboard/campaigns");
      revalidatePath("/dashboard");
      return {
        ok: true,
        message:
          campaign.status === "PENDING_REVIEW"
            ? "Submitted for review. We'll notify you when it's approved."
            : campaign.scheduledAt
              ? "Campaign scheduled."
              : "Sending started.",
        data: { id: campaign.id, status: campaign.status },
      };
    },
    { raw, requireVerifiedEmail: true },
  );
}

const idSchema = z.uuid();
type Op = "pause" | "resume" | "cancel" | "duplicate" | "delete";

export async function campaignOpAction(id: string, op: Op): Promise<ActionResult<{ id?: string }>> {
  return tenantAction<{ id?: string }>("campaigns:write", async (ctx) => {
    const cid = idSchema.parse(id);
    let message = "";
    let newId: string | undefined;
    switch (op) {
      case "pause":
        await pauseCampaign(ctx, cid);
        message = "Campaign paused. Unsent messages will wait until you resume.";
        break;
      case "resume":
        await resumeCampaign(ctx, cid);
        message = "Campaign resumed.";
        break;
      case "cancel":
        await cancelCampaign(ctx, cid);
        message = "Campaign cancelled. Unsent messages are refunded.";
        break;
      case "duplicate":
        newId = (await duplicateCampaign(ctx, cid)).id;
        message = "Copied as a new draft.";
        break;
      case "delete":
        await deleteDraft(ctx, cid);
        message = "Campaign deleted.";
        break;
    }
    revalidatePath("/dashboard/campaigns", "layout");
    return { ok: true, message, data: { id: newId } };
  });
}

/** Opens a draft in the composer. */
export async function editDraftAction(id: string) {
  redirect(`/dashboard/send?draft=${idSchema.parse(id)}`);
}
