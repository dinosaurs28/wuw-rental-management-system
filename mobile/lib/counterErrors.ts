import { Alert } from 'react-native';
import { router } from 'expo-router';

/**
 * Error codes the backend attaches (`{ message, code }`) when a counter rule
 * blocks an action. See apps/backend/src/services/payment/counter-guard.service.ts.
 */
export type CounterErrorCode = 'SHIFT_REQUIRED' | 'INVALID_UTR' | 'DUPLICATE_UTR';

export function counterErrorCode(err: any): CounterErrorCode | undefined {
  const code = err?.response?.data?.code;
  return code === 'SHIFT_REQUIRED' || code === 'INVALID_UTR' || code === 'DUPLICATE_UTR'
    ? code
    : undefined;
}

export function apiErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.message ?? fallback;
}

export const SHIFT_REQUIRED_MESSAGE =
  'Open your cash shift before taking bookings or collecting payments.';

/** Offers the way out of a SHIFT_REQUIRED block: straight to Open shift. */
export function promptOpenShift(message: string = SHIFT_REQUIRED_MESSAGE) {
  Alert.alert('Cash shift not open', message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open shift', onPress: () => router.push('/employee/shift/open') },
  ]);
}

/**
 * Shows the Open-shift prompt when `err` is SHIFT_REQUIRED and returns true,
 * so callers can skip their generic error display for that case.
 */
export function handleShiftRequired(err: any): boolean {
  if (counterErrorCode(err) !== 'SHIFT_REQUIRED') return false;
  promptOpenShift(apiErrorMessage(err, SHIFT_REQUIRED_MESSAGE));
  return true;
}
