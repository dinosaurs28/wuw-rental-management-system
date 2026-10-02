import { Alert, Linking } from 'react-native';
import { Colors } from '../../../constants/colors';
import { fmtIstDateTime } from '../../../lib/dates';
import type { OverdueReturn, ReturnState } from '../../../types/queue';

// Recovery tab (X5): customers who have not returned after the rental period.

export type RecoveryRow = OverdueReturn & { fetchedAt: number };

export const RECOVERY_PAGE_SIZE = 200;
export const RECOVERY_REFETCH_MS = 60_000;
// Re-renders the running "late by" durations between refetches.
export const RECOVERY_TICK_MS = 30_000;

// Badge per return state: red overdue, amber within the branch grace period,
// grey once the vehicle is back and only the paperwork is still open.
export const STATE_LOOK: Record<ReturnState, { label: string; color: string; bg: string }> = {
  OVERDUE: { label: 'Overdue', color: Colors.availNone, bg: Colors.availNoneSoft },
  IN_GRACE: { label: 'In grace', color: Colors.availLow, bg: Colors.availLowSoft },
  RETURN_IN_PROGRESS: { label: 'Return in progress', color: Colors.ink2, bg: '#0a0a0a0d' },
  AWAITING_MANAGER_CONFIRMATION: { label: 'Awaiting manager', color: Colors.ink2, bg: '#0a0a0a0d' },
};

// Minutes late right now: the server's figure at serverNow plus the time since
// the response arrived, so the duration keeps running between refetches.
export function liveOverdueMinutes(row: RecoveryRow, now: number) {
  return row.overdueMinutes + Math.max(0, Math.floor((now - row.fetchedAt) / 60_000));
}

// A grace period can run out between refetches; show the row as overdue then.
export function liveReturnState(row: RecoveryRow, minutes: number): ReturnState {
  if (row.returnState === 'IN_GRACE' && row.graceMinutes != null && minutes > row.graceMinutes) return 'OVERDUE';
  return row.returnState;
}

// Vehicle already back: lateness stopped and only the paperwork is open.
export function isVehicleBack(state: ReturnState) {
  return state === 'RETURN_IN_PROGRESS' || state === 'AWAITING_MANAGER_CONFIRMATION';
}

export function callPhone(phone: string) {
  Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`).catch(() =>
    Alert.alert('Could not start the call', `Dial ${phone} from the phone app.`),
  );
}

// wa.me wants the number as country code + digits, no plus or spaces.
// Indian numbers become 91XXXXXXXXXX; null when it cannot be one.
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function reminderMessage(row: OverdueReturn): string {
  const v = row.vehicles[0];
  const vehicle = v ? `${v.make} ${v.model}${v.regNo ? ` (${v.regNo})` : ''}` : 'the vehicle';
  const due = row.endAtDisplay || fmtIstDateTime(row.endAt);
  const name = row.customer.name?.trim();
  return (
    `Hello${name ? ` ${name}` : ''}, this is a gentle reminder from What U Want Rentals. ` +
    `Your rental of ${vehicle}, booking #${row.publicId.slice(-8).toUpperCase()}, was due back on ${due}. ` +
    `Please return it at the earliest, or let us know when you will be able to. Thank you.`
  );
}

export function openWhatsAppReminder(row: OverdueReturn) {
  const number = whatsappNumber(row.customer.phone) ?? whatsappNumber(row.customer.alternatePhone);
  if (!number) {
    Alert.alert('No WhatsApp number', 'This customer has no valid phone number on file.');
    return;
  }
  Linking.openURL(`https://wa.me/${number}?text=${encodeURIComponent(reminderMessage(row))}`).catch(() =>
    Alert.alert('Could not open WhatsApp', 'Make sure WhatsApp is installed on this phone.'),
  );
}
