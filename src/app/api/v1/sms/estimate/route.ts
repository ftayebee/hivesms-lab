import { apiHandler } from "@/lib/api/handler";
import { calculateSegments } from "@/lib/sms-segments";
import { messageCost, rateFor } from "@/lib/pricing";
import { getSmsPolicy } from "@/services/settings";
import { getOrganizationPlan } from "@/services/billing/pricing";
import { resolveSender } from "@/services/messaging/send";
import { estimateBody } from "@/features/public-api/schemas";

/** POST /api/v1/sms/estimate: segments and cost for a message. Nothing is sent or charged. */
export const POST = apiHandler({ auth: "apiKey", scopes: ["sms:send"], body: estimateBody }, async ({ body, ctx }) => {
  const [policy, plan, sender] = await Promise.all([getSmsPolicy(), getOrganizationPlan(ctx!.organizationId), resolveSender(ctx!.organizationId, body.sender_id)]);
  const seg = calculateSegments(body.message, policy.segmentation);
  const rate = rateFor(plan, body.type, sender.type);
  return {
    data: {
      encoding: seg.encoding,
      characters: seg.characters,
      units: seg.units,
      segments: seg.segments,
      max_segments: policy.segmentation.maxSegments,
      exceeds_max: seg.exceedsMax,
      recipients: body.recipients,
      sender_id: sender.value,
      sender_type: sender.type,
      rate: rate.toFixed(4),
      estimated_cost: messageCost(seg.segments, body.recipients, rate).toFixed(2),
      currency: "BDT",
    },
  };
});
