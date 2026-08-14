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
   * Pass extensionPublicId to include a PENDING_PAYMENT extension charge in the session.
   */
  async initiatePickupSession(
    bookingPublicId: string,
    payload?: {
      overrideRemainingBalance?: number;
      safetyDepositAmount?: number;
      safetyDepositReason?: string;
      extensionPublicId?: string;
      discountCode?: string;
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
    return data.data;
  },

  /**
   * Fetch the current PICKUP session for a booking.
   */
  async getPickupSession(bookingPublicId: string): Promise<PaymentSession> {
    const { data } = await apiClient.get(`/employee/bookings/${bookingPublicId}/pickup-session`);
    return data.data;
  },

  /**
   * Abandon an active PICKUP session (e.g., employee navigates away mid-flow).
   * Extension linked to the session stays PENDING_PAYMENT for manual handling.
   */
  async abandonPickupSession(bookingPublicId: string): Promise<void> {
    await apiClient.post(`/employee/bookings/${bookingPublicId}/pickup-session/abandon`);
  },

  /**
   * Fetch the current active PICKUP session for a booking. Returns null if none found.
   */
  async getActivePickupSession(bookingPublicId: string): Promise<PaymentSession | null> {
    try {
      const { data } = await apiClient.get(`/employee/bookings/${bookingPublicId}/pickup-session`);
      return data.data;
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },

  /**
   * Apply a discount code to the active PICKUP session.
   * Replaces any previously applied discount.
   */
  async applyDiscountToPickupSession(bookingPublicId: string, discountCode: string): Promise<PaymentSession> {
    const { data } = await apiClient.post(
      `/employee/bookings/${bookingPublicId}/pickup-session/apply-discount`,
      { discountCode },
    );
    return data.data;
  },

  /**
   * Remove the active discount from the PICKUP session.
   */
  async removeDiscountFromPickupSession(bookingPublicId: string): Promise<PaymentSession> {
    const { data } = await apiClient.delete(
      `/employee/bookings/${bookingPublicId}/pickup-session/remove-discount`,
    );
    return data.data;
  },

  /**
   * Add or replace the safety deposit entry in the active PICKUP session.
   */
  async addDepositToPickupSession(
    bookingPublicId: string,
    payload: { amount: number; reason: string },
  ): Promise<PaymentSession> {
    const { data } = await apiClient.post(
      `/employee/bookings/${bookingPublicId}/pickup-session/add-deposit`,
      payload,
    );
    return data.data;
  },

  /**
   * Remove the safety deposit entry from the active PICKUP session.
   */
  async removeDepositFromPickupSession(bookingPublicId: string): Promise<PaymentSession> {
    const { data } = await apiClient.delete(
      `/employee/bookings/${bookingPublicId}/pickup-session/remove-deposit`,
    );
    return data.data;
  },

  /**
   * Compute (or recompute) return charges and create a RETURN session.
   */
  async computeReturnSession(
    bookingPublicId: string,
    payload: {
      endOdometer: number;
      returnFuelLevel?: string;
      extraKmCharge?: number;
      fuelCharge?: number;
      fastagAmount?: number;
      fastagNotes?: string;
      otherCharges?: { label: string; amount: number }[];
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
   * Fetch the active RETURN session on page reload. Returns null if none found.
   * chargeBreakdown may be null for sessions computed before metadata was stored.
   */
  async getActiveReturnSession(bookingPublicId: string): Promise<ReturnSessionResponse | null> {
    try {
      const { data } = await apiClient.get(`/employee/bookings/${bookingPublicId}/return/session`);
      return data.data;
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },

  /**
   * Record a cash payment against an active session.
   * On success, triggers post-completion hooks (PICKUP → PICKED_UP, RETURN → RETURNED, etc.)
   */
  async recordPayment(
    sessionPublicId: string,
    payload: {
      method: "CASH" | "ONLINE" | "SPLIT";
      amount: number;
      idempotencyKey: string;
      notes?: string;
      onlineTransactionRef?: string;
      onlineGateway?: string;
      cashAmount?: number;
      onlineAmount?: number;
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
