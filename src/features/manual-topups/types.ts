/** Shapes of the Laravel manual top-up API (docs/22). */

export type PaymentMethodType = "BKASH" | "NAGAD" | "ROCKET" | "BANK" | "OTHER";

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  displayName: string;
  accountNumber: string;
  accountName: string | null;
  accountType: string | null;
  bankName: string | null;
  branchName: string | null;
  routingNumber: string | null;
  instructions: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  requireProof: boolean;
  requireSenderNumber: boolean;
  hasQr: boolean;
}

export interface AdminPaymentMethod extends PaymentMethod {
  active: boolean;
  sortOrder: number;
  qrName: string | null;
  updatedAt: string;
  createdAt: string;
}

export type TopUpStatus = "pending" | "under_review" | "approved" | "rejected" | "cancelled" | "refunded";

export interface TopUpRequest {
  id: string;
  reference: string | null;
  status: TopUpStatus;
  method: string | null;
  methodType: PaymentMethodType | null;
  paymentMethodId: string | null;
  amount: string;
  vatAmount: string;
  total: string;
  creditAmount: string;
  transactionId: string | null;
  senderNumber: string | null;
  paidAt: string | null;
  note: string | null;
  hasProof: boolean;
  proofName: string | null;
  rejectionReason: string | null;
  adminNote: string | null;
  submittedAt: string;
  completedAt: string | null;
}

export interface AdminTopUpRequest extends TopUpRequest {
  organization: { id: string; name: string } | null;
  flags: string[];
  internalNotes: Array<{ at: string; byId: string; note: string }>;
  review: { decision: string; byId: string; at: string; reason: string | null } | null;
  proofContentType: string | null;
  proofSize: number | null;
}

export const TOPUP_STATUS_LABEL: Record<TopUpStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

/** Maps request statuses onto the shared StatusBadge vocabulary. */
export const TOPUP_BADGE: Record<TopUpStatus, string> = {
  pending: "PENDING",
  under_review: "IN_PROGRESS",
  approved: "APPROVED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
  refunded: "REFUNDED",
};

export const METHOD_LABEL: Record<PaymentMethodType, string> = { BKASH: "bKash", NAGAD: "Nagad", ROCKET: "Rocket", BANK: "Bank transfer", OTHER: "Other" };
