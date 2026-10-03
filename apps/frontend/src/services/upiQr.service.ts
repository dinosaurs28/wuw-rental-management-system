import apiClient from "@/lib/axios";

// ── UPI QR payments (TODO #2) ────────────────────────────────────────────────
// A customer whose device has no UPI app pays their own online payment by
// scanning a Razorpay single-use, fixed-amount UPI QR from another phone. The
// QR pays the Razorpay order the booking hold / extension already has, so it is
// never a second charge. Customer-only endpoints (scratchpad contract G4).

export type UpiQrPurpose = "ADVANCE" | "FULL_PAYMENT" | "EXTENSION";
export type UpiQrStatus = "ACTIVE" | "PAID" | "CLOSED" | "EXPIRED";
export type UpiQrOutcome = "PENDING" | "CONFIRMED" | "REFUND_REQUIRED" | "EXPIRED" | "CLOSED";
export type UpiQrRefundReason =
  | "HOLD_LAPSED"
  | "BOOKING_CANCELLED"
  | "DUPLICATE_PAYMENT"
  | "AMOUNT_MISMATCH"
  | "EXTENSION_CLOSED";

export interface UpiQrView {
  /** Use for the status poll and close. */
  qrPaymentId: string;
  /** Razorpay `qr_xxx`. */
  qrId: string;
  purpose: UpiQrPurpose;
  /** Booking publicId (the hold id for a booking payment). */
  bookingId: string;
  extensionId: string | null;
  /** Razorpay ORDER id the payment settles under — `/payment/status/:transactionId` works too. */
  transactionId: string | null;
  /** Rupees, a JSON number. The QR only accepts this exact amount. */
  amount: number;
  currency: "INR";
  /** Razorpay link serving the QR PNG. */
  imageUrl: string;
  status: UpiQrStatus;
  outcome: UpiQrOutcome;
  reason: UpiQrRefundReason | null;
  /** Customer-facing text for the current outcome — shown as is. */
  message: string;
  /** True while the gateway can't be reached: the payment is unknown, never failed. */
  gatewayUnreachable: boolean;
  /** ISO — the countdown runs to this. */
  closeBy: string;
  /** 0 unless ACTIVE. */
  expiresInSeconds: number;
  paidAt: string | null;
  createdAt: string;
  /** The still-open QR for the same payment was returned instead of a new one. */
  reused: boolean;
  booking: { publicId: string; status: string; paymentStatus: string };
  extension: { publicId: string; extensionStatus: string; newEndAt: string | null } | null;
}

/** What a QR pays: a booking hold's online payment, or a customer self-pay extension. */
export type UpiQrTarget = { bookingId: string } | { extensionId: string };

/**
 * Error codes POST /payment/upi-qr (and the poll / close) answer with, as
 * `{ success:false, code, message }`. The message is always customer-readable.
 */
export type UpiQrErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_ONLINE_PAYMENT"
  | "BOOKING_NOT_EXTENDABLE"
  | "NOTHING_TO_PAY"
  | "BOOKING_NOT_FOUND"
  | "EXTENSION_NOT_FOUND"
  | "NOT_FOUND"
  | "QR_NOT_FOUND"
  | "BOOKING_ALREADY_PAID"
  | "EXTENSION_ALREADY_PAID"
  | "HOLD_EXPIRED"
  | "QR_HOLD_TOO_SHORT"
  | "EXTENSION_NOT_PAYABLE"
  | "VEHICLE_NOT_FREE"
  | "DL_IN_USE"
  | "AMOUNT_MISMATCH"
  | "QR_BUSY"
  | "QR_LIMIT_REACHED"
  | "GATEWAY_UNAVAILABLE"
  | "QR_CREATE_FAILED"
  | "UPI_QR_DISABLED";

/** Answered by cancel hold / cancel extension when an open QR had already been paid. */
export const UPI_QR_ALREADY_PAID = "UPI_QR_ALREADY_PAID";

type ApiErrorLike = { response?: { status?: number; data?: { code?: unknown; message?: unknown } } };

/** The `code` of a failed API call, when the server sent one. */
export function apiErrorCode(err: unknown): string | undefined {
  const code = (err as ApiErrorLike | undefined)?.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}

export const upiQrService = {
  /** Whether to offer "Pay by scanning a UPI QR" at all (ops switch + gateway keys). */
  getAvailability: () =>
    apiClient
      .get<{ success: true; data: { enabled: boolean } }>("/payment/upi-qr/availability")
      .then((r) => r.data.data),

  /** Creates the QR, or returns the still-open one for the same payment (`reused: true`). */
  create: (target: UpiQrTarget) =>
    apiClient
      .post<{ success: true; data: UpiQrView }>("/payment/upi-qr", target)
      .then((r) => r.data.data),

  /** Status poll (every 3 s). Confirms the booking / extension as soon as the payment lands. */
  getStatus: (qrPaymentId: string) =>
    apiClient
      .get<{ success: true; data: UpiQrView }>(`/payment/upi-qr/${encodeURIComponent(qrPaymentId)}`)
      .then((r) => r.data.data),

  /** Stops the QR taking money (customer left it or chose another way to pay). */
  close: (qrPaymentId: string) =>
    apiClient
      .post<{ success: true; data: UpiQrView }>(
        `/payment/upi-qr/${encodeURIComponent(qrPaymentId)}/close`,
      )
      .then((r) => r.data.data),
};
