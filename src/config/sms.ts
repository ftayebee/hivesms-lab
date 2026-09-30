import type { SegmentationRules } from "@/lib/sms-segments";

/**
 * Default SMS policy. Every value here can be overridden at runtime by an admin
 * (Admin → Settings → SMS policy), because the correct values depend on the connected
 * provider and on current regulation.
 */
export const defaultSegmentationRules: SegmentationRules = {
  // Standard GSM 03.38 limits. Some providers bill differently; adjust per provider.
  gsm7: { single: 160, multipart: 153 },
  ucs2: { single: 70, multipart: 67 },
  maxSegments: 10,
};

export const defaultSmsPolicy = {
  segmentation: defaultSegmentationRules,
  /** Refund the charge when the provider reports a final failure. */
  refundFailedMessages: true,
  /** Maximum dispatch attempts for transient provider errors. */
  maxAttempts: 4,
  /** Promotional quiet hours in Asia/Dhaka (24h clock). null disables. Configure to match current rules. */
  promotionalQuietHours: { start: 21, end: 9 } as { start: number; end: number } | null,
  /** Append an opt-out hint to promotional messages. */
  promotionalOptOutText: "Reply STOP to opt out",
  appendOptOutText: false,
  /** Campaigns larger than this always require review, even for trusted organizations. */
  reviewThresholdRecipients: 5000,
  /** Keywords (case-insensitive) treated as opt-out when received via inbound SMS webhooks. */
  optOutKeywords: ["STOP", "UNSUBSCRIBE", "বন্ধ"],
  /** Max recipients accepted in one API bulk request. */
  maxBulkRecipients: 1000,
  /** Max recipients in one campaign. */
  maxCampaignRecipients: 200000,
};

export type SmsPolicy = typeof defaultSmsPolicy;
