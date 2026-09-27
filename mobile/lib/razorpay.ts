import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import RazorpayCheckout, { type RazorpayOptions, type RazorpaySuccess } from 'react-native-razorpay';
import { buildCheckoutOptions, type CheckoutMode } from './razorpayOptions';

export type { CheckoutMode };

/**
 * Opens Razorpay Checkout for an order the backend already created. Both modes
 * pay the same order, so each caller's verify/poll path is unchanged.
 */
export function openRazorpayCheckout(
  options: RazorpayOptions,
  { mode }: { mode: CheckoutMode },
): Promise<RazorpaySuccess> {
  return RazorpayCheckout.open(buildCheckoutOptions(options, mode));
}

/** Razorpay rejects both for real failures and for the user closing the sheet. */
export function isCheckoutCancelled(err: any): boolean {
  return /cancel/i.test(err?.description ?? '');
}

// In QR mode the customer pays on ANOTHER phone, and this phone's sheet is
// often closed by hand after the money went through — which Razorpay reports
// as a cancel. So a QR "cancel" polls the flow's status for ~30s before it is
// treated as one.
export const QR_CANCEL_POLL_DELAYS = [2000, 3000, 5000, 5000, 5000, 5000, 5000];
export const CHECKING_PAYMENT_TEXT = 'Checking if the payment went through…';

// iOS can only probe schemes listed in LSApplicationQueriesSchemes (app.json):
// Google Pay, PhonePe, Paytm. Android probes the generic upi:// scheme, which
// needs the <queries> entry added by plugins/withUpiQueries.js.
const IOS_UPI_SCHEMES = ['tez://', 'phonepe://', 'paytmmp://'];

let upiAppResult: boolean | null = null;
let upiAppProbe: Promise<boolean> | null = null;

async function probeUpiApp(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') return await Linking.canOpenURL('upi://pay');
    if (Platform.OS === 'ios') {
      const found = await Promise.all(IOS_UPI_SCHEMES.map((s) => Linking.canOpenURL(s)));
      return found.some(Boolean);
    }
  } catch {
    /* unknown — fall through */
  }
  // Unknown (probe failed or unsupported platform): assume a UPI app exists so
  // the normal sheet stays first.
  return true;
}

/** Whether this phone has a UPI app installed. Probed once per app launch. */
export function hasUpiApp(): Promise<boolean> {
  if (upiAppResult !== null) return Promise.resolve(upiAppResult);
  if (!upiAppProbe) {
    upiAppProbe = probeUpiApp().then((found) => {
      upiAppResult = found;
      return found;
    });
  }
  return upiAppProbe;
}

/** `hasUpiApp()` as state: null while the first probe is still running. */
export function useHasUpiApp(): boolean | null {
  const [found, setFound] = useState<boolean | null>(upiAppResult);
  useEffect(() => {
    if (found !== null) return;
    let alive = true;
    hasUpiApp().then((v) => { if (alive) setFound(v); });
    return () => { alive = false; };
  }, [found]);
  return found;
}
