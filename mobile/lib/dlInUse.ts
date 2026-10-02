import { Alert } from 'react-native';

/**
 * 409 DL_IN_USE — one vehicle per driving licence (X3). The server refuses a
 * booking, pickup or extension while the same DL number has a vehicle out, or
 * a HOLD / CONFIRMED booking overlapping the dates. Customer responses carry a
 * message only; staff responses add `conflictingBooking`.
 * See apps/backend/src/services/booking/dl-in-use.service.ts.
 */
export const DL_IN_USE = 'DL_IN_USE';

export interface DlConflictingBooking {
  publicId: string;
  status: string;
  vehicle: { make: string; model: string; regNo: string } | null;
  startAt: string;
  endAt: string;
  customerName: string;
}

export function isDlInUse(err: any): boolean {
  return err?.response?.data?.code === DL_IN_USE;
}

/** The booking holding the licence (staff responses only), or null. */
export function dlConflictingBooking(err: any): DlConflictingBooking | null {
  if (!isDlInUse(err)) return null;
  const booking = err?.response?.data?.conflictingBooking;
  return booking && typeof booking.publicId === 'string' ? (booking as DlConflictingBooking) : null;
}

const STATUS_LABELS: Record<string, string> = {
  PICKED_UP: 'Vehicle out',
  CONFIRMED: 'Confirmed',
  HOLD: 'On hold',
};

/** "Conflicting booking ABC123 · Vehicle out · Honda Activa (KA01AB1234)", or null. */
export function dlConflictLabel(err: any): string | null {
  const booking = dlConflictingBooking(err);
  if (!booking) return null;
  const parts = [`Conflicting booking ${booking.publicId}`];
  parts.push(STATUS_LABELS[booking.status] ?? booking.status);
  if (booking.vehicle) {
    parts.push(`${booking.vehicle.make} ${booking.vehicle.model} (${booking.vehicle.regNo})`);
  }
  return parts.join(' · ');
}

/** Inline error text for a DL_IN_USE refusal (message + conflicting booking), or null. */
export function dlInUseErrorText(err: any): string | null {
  if (!isDlInUse(err)) return null;
  const message: string =
    err?.response?.data?.message ?? 'This driving licence is already linked to another booking.';
  const label = dlConflictLabel(err);
  return label ? `${message}\n${label}` : message;
}

/**
 * Shows the DL_IN_USE refusal (server message + the conflicting booking ID on
 * staff screens) and returns true, so callers can skip their generic alert.
 */
export function handleDlInUse(err: any, onDismiss?: () => void): boolean {
  const text = dlInUseErrorText(err);
  if (text == null) return false;
  Alert.alert('Driving licence in use', text, [{ text: 'OK', onPress: onDismiss }]);
  return true;
}
