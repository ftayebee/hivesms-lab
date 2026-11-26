/** Shapes returned by the Laravel report-import API (docs/24). Money values are BDT strings. */

export type ImportStatus = "DELIVERED" | "SUBMITTED" | "FAILED" | "REJECTED" | "EXPIRED";

export interface ImportRow {
  line: number;
  to: string;
  operator: string;
  senderValue: string;
  senderType: "MASKING" | "NON_MASKING";
  smsType: "TRANSACTIONAL" | "PROMOTIONAL";
  body: string;
  encoding: "GSM7" | "UCS2";
  segments: number;
  unitPrice: string;
  cost: string;
  status: ImportStatus;
  sentAt: string;
  deliveredAt: string | null;
  errorMessage: string | null;
  clientReference: string | null;
}

export interface ImportSummary {
  fileName: string;
  columns: Record<string, string>;
  rowCount: number;
  valid: number;
  skipped: number;
  segments: number;
  billable: number;
  totalCost: string;
  byStatus: Partial<Record<ImportStatus, number>>;
  firstSentAt: string | null;
  lastSentAt: string | null;
  errors: Array<{ line: number; reason: string }>;
}

export interface ImportPreview extends ImportSummary {
  organization: { id: string; name: string };
  balance: string;
  sufficientBalance: boolean;
  alreadyImported: { id: string; createdAt: string; importedCount: number } | null;
  rows: ImportRow[];
}

export interface ReportImportRecord {
  id: string;
  organization: { id: string; name: string | null };
  createdBy: { id: string; name: string } | null;
  fileName: string;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  segments: number;
  totalCost: string;
  charged: boolean;
  walletTransactionId: string | null;
  firstSentAt: string | null;
  lastSentAt: string | null;
  note: string | null;
  createdAt: string;
}
