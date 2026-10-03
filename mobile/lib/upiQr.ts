import { useQuery } from '@tanstack/react-query';
import { upiQrApi } from './api';
import type { UpiQrView } from '../types/upiQr';

// UPI QR from another phone (item 2): a Razorpay single-use QR for the order
// the booking / extension already has. Customer screens only — the endpoints
// are customer-only (staff keep Razorpay Checkout's own QR block).

/** The pay option's label (checkout + trip extension). */
export const UPI_QR_OPTION_LABEL = 'Scan a UPI QR from another phone';

/** Shown above the options when this phone has no UPI app (the QR comes first). */
export const NO_UPI_APP_QR_NOTE =
  'No UPI app on this phone? Scan a UPI QR with any UPI app on another phone to pay.';

/** Status poll cadence while the QR is on screen (the server checks Razorpay at most every 2.5 s). */
export const UPI_QR_POLL_MS = 3000;

export const UPI_QR_AVAILABILITY_KEY = ['upi-qr-availability'] as const;

/**
 * Whether the server offers the UPI QR. False while unknown, when switched off
 * (RAZORPAY_UPI_QR_ENABLED=false / no keys) or on an older server (404) — the
 * screen then keeps Razorpay Checkout's own QR option.
 */
export function useUpiQrAvailable(enabled = true): boolean {
  const { data } = useQuery({
    queryKey: UPI_QR_AVAILABILITY_KEY,
    queryFn: async () => (await upiQrApi.availability()).data?.data?.enabled === true,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data === true;
}

/** The payment is already made (any channel) — go to the success state. */
const ALREADY_PAID = new Set(['BOOKING_ALREADY_PAID', 'EXTENSION_ALREADY_PAID', 'UPI_QR_ALREADY_PAID']);

/** Worth asking again in a moment (gateway hiccup, a create racing another). */
const RETRYABLE = new Set(['GATEWAY_UNAVAILABLE', 'QR_BUSY', 'INTERNAL_ERROR']);

/**
 * Only the QR failed — the order itself can still be paid in Razorpay Checkout.
 * Anything else (vehicle no longer free, DL in use, extension closed…) stops
 * the payment altogether.
 */
const QR_ONLY = new Set([
  'UPI_QR_DISABLED',
  'QR_CREATE_FAILED',
  'GATEWAY_UNAVAILABLE',
  'QR_LIMIT_REACHED',
  'QR_HOLD_TOO_SHORT',
  'QR_BUSY',
  'QR_NOT_FOUND',
  'INTERNAL_ERROR',
]);

export interface UpiQrError {
  /** Server code, or null for a network failure / unexpected reply. */
  code: string | null;
  message: string;
  alreadyPaid: boolean;
  holdExpired: boolean;
  retryable: boolean;
  /** Razorpay Checkout can still take this payment. */
  qrOnly: boolean;
}

export function upiQrError(err: any, fallback = "We couldn't make the UPI QR. Please try again."): UpiQrError {
  const body = err?.response?.data;
  const code: string | null = typeof body?.code === 'string' ? body.code : null;
  // No response at all: offline / timed out — treat like a gateway hiccup.
  const network = !err?.response;
  return {
    code,
    message:
      body?.message ??
      (network ? "We couldn't reach the server. Check your connection and try again." : fallback),
    alreadyPaid: !!code && ALREADY_PAID.has(code),
    holdExpired: code === 'HOLD_EXPIRED',
    retryable: network || (!!code && RETRYABLE.has(code)),
    qrOnly: network || (!!code && QR_ONLY.has(code)),
  };
}

/**
 * What an ended QR (EXPIRED / CLOSED) offers next. An extension can always get
 * a new QR. A booking only while its hold has time left: a booking QR expires
 * 45 s before the hold does, so an EXPIRED one means "start the booking again".
 * Null while the QR is still in play (or settled).
 */
export function endedQrAction(
  view: Pick<UpiQrView, 'outcome' | 'purpose' | 'booking'>,
): 'regenerate' | 'start-again' | null {
  if (view.outcome !== 'EXPIRED' && view.outcome !== 'CLOSED') return null;
  if (view.purpose === 'EXTENSION') return 'regenerate';
  return view.outcome === 'CLOSED' && view.booking.status === 'HOLD' ? 'regenerate' : 'start-again';
}

/** "8:05" — the QR's time left. */
export function countdownText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
