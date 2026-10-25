import apiClient from "@/lib/axios";
import type { CounterRefundMethod } from "@/lib/counterPayment";

/**
 * Fleet refund at the drop (Oct 25 2026, client: "Refund during drop should be
 * given to fleet members") — what is owed back once the drop is recorded and not
 * on a drop bill: a legacy drop's deposit, a drop bill's refund sent to the
 * manager, money paid beyond what the booking owes.
 */
export interface DropRefundOptions {
  bookingPublicId: string;
  bookingStatus: string;
  /** Everything owed back now (2-dp string) */
  owedBack: string;
  depositToRefund: string;
  overpaidToRefund: string;
  safetyDepositHandling: "SET_OFF" | "REFUND_IN_FULL" | null;
  canRefund: boolean;
  blockedCode: string | null;
  blockedReason: string | null;
  cashShiftOpen: boolean;
  proofRequiredMethods: CounterRefundMethod[];
}

export interface DropRefundResult {
  publicId: string;
  method: CounterRefundMethod;
  amount: string;
  status: string;
  remainingOwedBack: string;
  cashShiftPublicId: string | null;
  proofFileId: string | null;
}

const path = (bookingPublicId: string) => `/employee/bookings/${encodeURIComponent(bookingPublicId)}/drop-refund`;

export const dropRefundService = {
  get: async (bookingPublicId: string): Promise<DropRefundOptions> => {
    const res = await apiClient.get<{ data: DropRefundOptions }>(path(bookingPublicId));
    return res.data.data;
  },
  /** CASH / UPI / BANK_TRANSFER — UPI and bank need `proof_file_id` (REFUND_PROOF_REQUIRED). */
  refund: async (
    bookingPublicId: string,
    body: { method: CounterRefundMethod; amount?: number; proof_file_id?: string; notes?: string },
  ): Promise<{ message: string; data: DropRefundResult }> => {
    const res = await apiClient.post<{ message: string; data: DropRefundResult }>(path(bookingPublicId), body);
    return res.data;
  },
};
