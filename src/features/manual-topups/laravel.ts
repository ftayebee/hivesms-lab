import "server-only";
import { laravel, laravelData } from "@/lib/laravel-api";
import type { AdminPaymentMethod, AdminTopUpRequest, PaymentMethod, TopUpRequest } from "./types";

/** Reads for the wallet and admin pages (Laravel only, opt-in `manualTopups`). */

export async function customerMethods() {
  return laravelData<{ methods: PaymentMethod[]; policy: { vatRatePercent: number; minimumTopUp: number; maximumTopUp: number; proofMaxBytes: number } }>("app/payment-methods");
}

export async function customerRequests(page = 1) {
  const res = await laravel.get<TopUpRequest[]>("app/topup-requests", { page });
  return { rows: res.data, total: Number(res.meta.total ?? res.data.length) };
}

export async function adminMethods() {
  return laravelData<AdminPaymentMethod[]>("admin/payment-methods");
}

export async function adminRequests(q: { status?: string; from?: string; to?: string; methodId?: string; q?: string; page: number }) {
  const res = await laravel.get<AdminTopUpRequest[]>("admin/topup-requests", q);
  return { rows: res.data, total: Number(res.meta.total ?? 0), pageSize: Number(res.meta.pageSize ?? 20) };
}

export async function adminRequest(id: string) {
  return laravelData<AdminTopUpRequest>(`admin/topup-requests/${encodeURIComponent(id)}`);
}
