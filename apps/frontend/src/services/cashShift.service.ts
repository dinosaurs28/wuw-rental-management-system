/**
 * Financials → Cash Shift (Oct 2026): the branch manager sees Fleet members'
 * shifts and closes them once the cash is handed over ("Verify & close").
 * Fleet members only open shifts and collect; they can't close any shift.
 *
 * Expected cash (computed by the server, never typed):
 *   opening float + cash collected − cash refunded out of the shift.
 */
import apiClient from "@/lib/axios";
import { paymentService } from "@/services/payment.service";

export type ShiftResult = "MATCHED" | "MISMATCH";

/** One shift row (open or closed). Money is 2-dp strings. */
export interface CashShiftRow {
  publicId: string;
  status: "OPEN" | "CLOSED" | "DISCREPANCY_FLAGGED";
  isOpen: boolean;
  istDate: string;
  openedAt: string;
  closedAt: string | null;
  employeePublicId: string;
  employeeName: string;
  branchName: string | null;
  openingCash: string;
  cashCollected: string;
  cashRefunded: string;
  expectedCash: string;
  nonCashCollected: string;
  nonCashRefunded: string;
  totalCollected: string;
  paymentCount: number;
  cashReceived: string | null;
  difference: string | null;
  result: ShiftResult | null;
  closedByName: string | null;
  closedByManager: boolean;
  discrepancyExplanation: string | null;
  legacyVariance: boolean;
}

export interface ShiftPaymentAllocation {
  type: string;
  amount: number;
  cash: number;
  online: number;
}

export interface CashShiftPayment {
  publicId: string;
  bookingPublicId: string;
  customerName: string | null;
  purpose: string;
  method: "CASH" | "ONLINE" | "SPLIT";
  status: string;
  direction: "IN" | "OUT";
  totalAmount: string;
  cashAmount: string;
  onlineAmount: string;
  onlineGateway: string | null;
  onlineTransactionRef: string | null;
  collectedAt: string | null;
  createdAt: string | null;
  collectedByName: string | null;
  rejectionReason: string | null;
  notes: string | null;
  linkedAfterClose: boolean;
  /** The six payment types this row paid (shared with Financials). Empty for refunds / voided rows. */
  paymentTypes?: string[];
  allocations?: ShiftPaymentAllocation[];
  voidShiftClosed?: boolean;
  proofPhotoUrl?: string | null;
  proofs?: { fileId: string; position: number; url: string }[];
}

export interface CashShiftDetail extends CashShiftRow {
  typeBreakdown: Array<{ type: string; label: string; cash: string; nonCash: string; total: string }>;
  refundsPaidOut: { cash: string; nonCash: string };
  expectedCashComponents: { openingCash: string; cashCollected: string; cashRefunded: string; expectedCash: string };
  transactions: CashShiftPayment[];
}

export interface CashShiftCards {
  openShifts: number;
  cashWithFleet: string;
  nonCashWithFleet: string;
  closedToday: { count: number; cashReceived: string };
  mismatches: number;
  range: { from: string; to: string };
}

export interface CashShiftListFilters {
  employeePublicId?: string;
  from?: string;
  to?: string;
  result?: ShiftResult;
}

export interface UnconfirmedPayment {
  transactionPublicId: string;
  bookingPublicId: string;
  customerName: string | null;
  purpose: string;
  method: string;
  amount: string;
  cashAmount: string;
  onlineAmount: string;
  isUpi: boolean;
  onlineTransactionRef: string | null;
  collectedAt: string;
  employeeName: string | null;
  shiftPublicId: string | null;
  shiftStatus: string | null;
  notes: string | null;
  proofPhotoUrl?: string | null;
}

export interface CloseShiftPayload {
  cashReceived: number;
  note?: string;
  /** The expected cash the manager was shown; a moved figure gets 409 EXPECTED_CASH_CHANGED. */
  expectedCash: number;
}

const BASE = "/branchManager/payment/shifts";

export const cashShiftService = {
  cards: (range: { from?: string; to?: string }) =>
    apiClient.get<{ data: CashShiftCards }>(`${BASE}/cards`, { params: range }).then((r) => r.data.data),

  listOpen: (page = 1, pageSize = 50, employeePublicId?: string) =>
    apiClient
      .get<{ shifts: CashShiftRow[]; total: number }>(BASE, {
        params: { page, pageSize, status: "OPEN", ...(employeePublicId ? { employeePublicId } : {}) },
      })
      .then((r) => ({ data: r.data.shifts ?? [], total: r.data.total ?? 0 })),

  listClosed: (page = 1, pageSize = 20, f: CashShiftListFilters = {}) =>
    apiClient
      .get<{ shifts: CashShiftRow[]; total: number }>(BASE, {
        params: {
          page,
          pageSize,
          status: "ENDED",
          dateField: "CLOSED",
          ...(f.employeePublicId ? { employeePublicId: f.employeePublicId } : {}),
          ...(f.from ? { from: f.from } : {}),
          ...(f.to ? { to: f.to } : {}),
          ...(f.result ? { result: f.result } : {}),
        },
      })
      .then((r) => ({ data: r.data.shifts ?? [], total: r.data.total ?? 0 })),

  detail: (publicId: string) =>
    apiClient.get<{ data: CashShiftDetail }>(`${BASE}/${publicId}`).then((r) => r.data.data),

  close: (publicId: string, payload: CloseShiftPayload) =>
    apiClient
      .post<{ message: string; data: { status: string; result: ShiftResult; difference: string } }>(
        `${BASE}/${publicId}/close`,
        payload,
      )
      .then((r) => r.data),

  unconfirmed: (page = 1, pageSize = 50) =>
    apiClient
      .get<{ transactions: UnconfirmedPayment[]; total: number }>(`${BASE}/unconfirmed`, { params: { page, pageSize } })
      .then((r) => r.data),

  /** One COLLECTED payment confirmed / rejected (outside open shifts, or rejected before a close). */
  confirmPayment: (txnPublicId: string) => paymentService.confirmCash(txnPublicId),
  rejectPayment: (txnPublicId: string, reason: string) => paymentService.rejectCash(txnPublicId, reason),
};
