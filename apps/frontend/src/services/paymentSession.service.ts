import apiClient from "@/lib/axios";

// ── Shared types ─────────────────────────────────────────────────────────────

export interface LedgerEntry {
  publicId: string;
  entryType: string;
  classification: string;
  amount: string;
  gstAmount: string;
  description: string;
  referenceId: string | null;
  referenceType: string | null;
  isVoided: boolean;
  createdAt: string;
}

export interface PaymentSession {
  publicId: string;
  sessionType: "PICKUP" | "EXTENSION" | "RETURN";
  status: "OPEN" | "COMPUTING" | "AWAITING_PAYMENT" | "PAYMENT_INITIATED" | "COMPLETED" | "ABANDONED";
  netPayable: string;
  totalCharges: string;
  totalDiscounts: string;
  totalPaymentsRecorded: string;
  taxableBase: string;
  nonTaxableBase: string;
  gstAmount: string;
  isRefund: boolean;
  entries: LedgerEntry[];
}

export interface ReturnChargeEntry {
  chargeType: string;
  moduleKey: string;
  label: string;
  originalAmount: string;
  finalAmount: string;
  quantity: string | null;
  unitRate: string | null;
  isOverridden: boolean;
  notes: string | null;
}

export interface ReturnSessionResponse {
  session: PaymentSession;
  chargeBreakdown: {
    subtotal: string;
    waivedTotal: string;
    finalTotal: string;
    charges: ReturnChargeEntry[];
  };
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const paymentSessionService = {
  /**
   * Fetch a session by its public ID.
   */
  async getSession(sessionPublicId: string): Promise<PaymentSession> {
    const { data } = await apiClient.get(`/employee/sessions/${sessionPublicId}`);
    return data.data;
  },

  /**
   * Get the active session for a booking.
   */
  async getActiveSession(bookingPublicId: string): Promise<PaymentSession> {
    const { data } = await apiClient.get(`/employee/bookings/${bookingPublicId}/active-session`);
    return data.data;
  },

  /**
   * Initiate a PICKUP payment session for a booking.
   * Accepts handover metadata (odo/fuel/photos) — saves them and defers vehicle
   * status change to when payment is recorded.
   */
  async initiatePickupSession(
    bookingPublicId: string,
    payload?: {
      overrideRemainingBalance?: number;
      safetyDepositAmount?: number;
      safetyDepositReason?: string;
      odo?: number;
      fuelLevel?: number;
      pickupFuelLevel?: string;
      pickupImageIds?: string[];
      captureImages?: { fileId: string; label: string }[];
    },
  ): Promise<PaymentSession> {
    const { data } = await apiClient.post(
      `/employee/bookings/${bookingPublicId}/pickup-session/initiate`,
      payload ?? {},
    );
    return data.data.session;
  },

  /**
   * Fetch the current PICKUP session for a booking.
   */
  async getPickupSession(bookingPublicId: string): Promise<PaymentSession> {
    const { data } = await apiClient.get(`/employee/bookings/${bookingPublicId}/pickup-session`);
    return data.data.session;
  },

  /**
   * Compute (or recompute) return charges and create a RETURN session.
   */
  async computeReturnSession(
    bookingPublicId: string,
    payload: {
      endOdometer: number;
      returnFuelLevel?: string;
      fuelDeficitCharge?: number;
      fuelSkipReason?: string;
      fastagAmount?: number;
      fastagNotes?: string;
      applyGrace?: boolean;
      returnImageIds?: string[];
    },
  ): Promise<ReturnSessionResponse> {
    const { data } = await apiClient.post(
      `/employee/bookings/${bookingPublicId}/return/session/compute`,
      payload,
    );
    return data.data;
  },

  /**
   * Fetch the current RETURN session for a booking.
   */
  async getReturnSession(bookingPublicId: string): Promise<ReturnSessionResponse> {
    const { data } = await apiClient.get(`/employee/bookings/${bookingPublicId}/return/session`);
    return data.data;
  },

  /**
   * Record a cash payment against an active session.
   * On success, triggers post-completion hooks (PICKUP → PICKED_UP, RETURN → RETURNED, etc.)
   */
  async recordPayment(
    sessionPublicId: string,
    payload: {
      method: "CASH" | "ONLINE";
      amount: number;
      idempotencyKey: string;
      notes?: string;
      onlineTransactionRef?: string;
      onlineGateway?: string;
    },
  ): Promise<PaymentSession> {
    const { data } = await apiClient.post(
      `/employee/sessions/${sessionPublicId}/record-payment`,
      payload,
    );
    return data.data;
  },

  /**
   * Record a refund against an active session (netPayable < 0 scenarios).
   */
  async recordRefund(
    sessionPublicId: string,
    payload: {
      method: "CASH" | "ONLINE";
      amount: number;
      idempotencyKey: string;
      notes?: string;
    },
  ): Promise<PaymentSession> {
    const { data } = await apiClient.post(
      `/employee/sessions/${sessionPublicId}/record-refund`,
      payload,
    );
    return data.data;
  },
};
