import { create } from "zustand";
import type { CashShift } from "@/services/payment.service";

// ── Types ────────────────────────────────────────────────────────────────────

type ModalType =
  | "open-shift"
  | "close-shift"
  | "record-payment"
  | "confirm-cash"
  | "reject-cash"
  | "settle"
  | "request-refund"
  | "approve-refund"
  | "reject-refund"
  | "complete-refund"
  | "reconcile-shift"
  | null;

interface ModalState {
  type: ModalType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: Record<string, any>;
}

interface PaymentStore {
  // Active shift for the current user
  activeShift: CashShift | null;
  activeShiftLoaded: boolean;

  // Badge counts for sidebar
  pendingCashCount: number;
  pendingRefundCount: number;

  // Modal state
  modal: ModalState;

  // Actions
  setActiveShift: (shift: CashShift | null) => void;
  setActiveShiftLoaded: (loaded: boolean) => void;
  setPendingCashCount: (count: number) => void;
  setPendingRefundCount: (count: number) => void;
  openModal: (type: ModalType, data?: Record<string, any>) => void;
  closeModal: () => void;
}

// ── Store ────────────────────────────────────────────────────────────────────

export const usePaymentStore = create<PaymentStore>((set) => ({
  activeShift: null,
  activeShiftLoaded: false,
  pendingCashCount: 0,
  pendingRefundCount: 0,
  modal: { type: null },

  setActiveShift: (shift) => set({ activeShift: shift }),
  setActiveShiftLoaded: (loaded) => set({ activeShiftLoaded: loaded }),
  setPendingCashCount: (count) => set({ pendingCashCount: count }),
  setPendingRefundCount: (count) => set({ pendingRefundCount: count }),
  openModal: (type, data) => set({ modal: { type, data } }),
  closeModal: () => set({ modal: { type: null } }),
}));
