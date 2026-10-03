// UPI QR payment (item 2) — a Razorpay single-use, fixed-amount UPI QR the
// customer scans from ANOTHER phone when this one has no UPI app. It pays the
// same Razorpay order the booking / extension already has, never a second charge.
// See apps/backend/src/services/payment/upi-qr.service.ts (UpiQrView).

export type UpiQrPurpose = 'ADVANCE' | 'FULL_PAYMENT' | 'EXTENSION';
export type UpiQrStatus = 'ACTIVE' | 'PAID' | 'CLOSED' | 'EXPIRED';
/** What the screen should do: keep showing the QR, or one of the end states. */
export type UpiQrOutcome = 'PENDING' | 'CONFIRMED' | 'REFUND_REQUIRED' | 'EXPIRED' | 'CLOSED';
export type UpiQrRefundReason =
  | 'HOLD_LAPSED'
  | 'BOOKING_CANCELLED'
  | 'DUPLICATE_PAYMENT'
  | 'AMOUNT_MISMATCH'
  | 'EXTENSION_CLOSED';

/** What a QR pays: a booking hold (its holdId) or a customer extension. */
export type UpiQrTarget = { bookingId: string } | { extensionId: string };

export interface UpiQrView {
  /** Poll / close with this. */
  qrPaymentId: string;
  /** Razorpay qr_xxx. */
  qrId: string;
  purpose: UpiQrPurpose;
  /** Booking publicId (= the checkout's holdId). */
  bookingId: string;
  extensionId: string | null;
  /** The Razorpay ORDER id this settles under — /api/payment/status/:transactionId works too. */
  transactionId: string | null;
  /** Rupees, a JSON number (not a Decimal string). The QR only accepts exactly this. */
  amount: number;
  currency: 'INR';
  /** https://rzp.io/i/… — redirects to the QR PNG. */
  imageUrl: string;
  status: UpiQrStatus;
  outcome: UpiQrOutcome;
  reason: UpiQrRefundReason | null;
  /** Customer-facing text for the current outcome — shown as is. */
  message: string;
  /** Razorpay didn't answer this time: still PENDING ("unknown", never "failed"). */
  gatewayUnreachable: boolean;
  /** ISO — when the QR stops taking money. */
  closeBy: string;
  /** 0 unless ACTIVE. */
  expiresInSeconds: number;
  paidAt: string | null;
  createdAt: string;
  /** The still-open QR for the same payment came back (create is safe to repeat). */
  reused: boolean;
  booking: { publicId: string; status: string; paymentStatus: string };
  extension: { publicId: string; extensionStatus: string; newEndAt: string | null } | null;
}
