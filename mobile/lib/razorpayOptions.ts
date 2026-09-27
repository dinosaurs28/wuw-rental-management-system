import type { RazorpayOptions } from 'react-native-razorpay';
import { Colors } from '../constants/colors';

/**
 * 'default' — Razorpay's normal sheet (UPI apps, cards, netbanking…).
 * 'qr'      — the same sheet with a "scan the UPI QR" block on top, for phones
 *             with no UPI app: the customer scans it with their own phone.
 *             Razorpay only renders the UPI QR with LIVE keys.
 */
export type CheckoutMode = 'default' | 'qr';

// The QR block is only listed FIRST — Razorpay's other methods stay below it.
// Hiding them (show_default_blocks: false) left a phone with no UPI app, or a
// sheet where Razorpay can't draw the QR, with no usable method at all: the
// payment failed and the customer couldn't switch to card or netbanking.
const QR_CONFIG = {
  display: {
    blocks: {
      upiqr: {
        name: 'Scan QR with any UPI app',
        instruments: [{ method: 'upi', flows: ['qr'] }],
      },
    },
    sequence: ['block.upiqr'],
    preferences: { show_default_blocks: true },
  },
};

// A failed attempt (e.g. choosing UPI on a phone with no UPI app) keeps the
// sheet open so the customer can pick another method, instead of closing it
// and reporting the whole payment as failed.
const RETRY = { enabled: true, max_count: 4 };

/** The options object handed to RazorpayCheckout.open for an existing order. */
export function buildCheckoutOptions(options: RazorpayOptions, mode: CheckoutMode): RazorpayOptions {
  return {
    name: 'WUW Rentals',
    theme: { color: Colors.orange },
    retry: RETRY,
    ...options,
    currency: options.currency || 'INR',
    ...(mode === 'qr' ? { config: QR_CONFIG } : {}),
  };
}
