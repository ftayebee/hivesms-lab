/** Shapes of the Laravel Dynamic SMS API (docs/20). Shared by server actions and the composer. */

export interface DynamicUpload {
  id: string;
  fileName: string;
  sizeBytes: number;
  headers: string[];
  rowCount: number;
  emptyRows: number;
  malformedRows: number;
  preview: Array<{ line: number; cells: Record<string, string>; malformed: boolean }>;
  suggestedRecipientColumn: string | null;
  suggestedSenderColumn: string | null;
  status: string;
  expiresAt: string;
}

export interface DynamicStats {
  totalRows: number;
  valid: number;
  invalid: number;
  invalidPhone: number;
  duplicates: number;
  missingValues: number;
  invalidSender: number;
  malformed: number;
  tooLong: number;
  blockedContent: number;
  blocked: number;
  suppressed: number;
  segments: number;
  maxSegments: number;
  unicodeRows: number;
  estimatedCost: string;
}

export interface DynamicPreviewRow {
  line: number;
  recipient: string;
  status: string;
  reason: string | null;
  message: string | null;
  sender: string | null;
  segments: number;
  encoding: "GSM7" | "UCS2" | null;
  cost: string;
}

export interface DynamicPreview {
  stats: DynamicStats;
  fields: string[];
  usedFields: string[];
  rows: DynamicPreviewRow[];
  offset: number;
  total: number;
}

export interface DynamicEstimate {
  name: string;
  messageType: "TRANSACTIONAL" | "PROMOTIONAL";
  recipients: number;
  stats: DynamicStats;
  senderValue: string;
  senderColumn: string | null;
  recipientColumn: string;
  variables: string[];
  segments: number;
  segmentsPerMessageMax: number;
  estimatedCost: string;
  balance: string;
  sufficientBalance: boolean;
  requiresReview: boolean;
  reviewReasons: string[];
  scheduledAt: string | null;
  batchSize: number;
  batches: number;
  sample: { recipient: string; message: string } | null;
}

export interface DynamicInput {
  uploadId: string;
  recipientColumn: string;
  senderColumn?: string | null;
  senderId?: string;
  message: string;
  smsType: "TRANSACTIONAL" | "PROMOTIONAL";
  name?: string;
  missingValues?: "skip" | "reject";
  batchSize?: number;
  scheduleMode?: "now" | "later";
  scheduledAt?: string;
  offset?: number;
  limit?: number;
  confirmed?: boolean;
}

/** Placeholders `{{Column Name}}` of a template (case-insensitive match against fields). */
export function templateTokens(template: string): string[] {
  return [...template.matchAll(/\{\{\s*([^{}]{1,64}?)\s*\}\}/gu)].map((m) => m[1].trim());
}

/** Unknown placeholders of a template for the given fields (client-side hint; the API decides). */
export function unknownTokens(template: string, fields: string[]): string[] {
  const known = new Set(fields.map((f) => f.toLowerCase()));
  return [...new Set(templateTokens(template).filter((t) => !known.has(t.toLowerCase())))];
}
