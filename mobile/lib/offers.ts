// Helpers for the home offer posters (#15).
import { Clipboard, Share } from 'react-native';
import type { OfferCoupon } from '../types/offers';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** "20% off · up to ₹500" / "₹200 off" — from the coupon the server attached. */
export function offerCouponSummary(c: OfferCoupon | null | undefined): string | null {
  if (!c) return null;
  const value = Number(c.value);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (c.discountType === 'PERCENTAGE') {
    const cap = c.maxDiscountCap != null ? Number(c.maxDiscountCap) : null;
    return cap != null && Number.isFinite(cap) && cap > 0
      ? `${value}% off · up to ${rupees(cap)}`
      : `${value}% off`;
  }
  return `${rupees(value)} off`;
}

export type CopyResult = 'copied' | 'shared' | 'failed';

/**
 * Puts a coupon code on the clipboard. Uses React Native's built-in clipboard
 * (still shipped in core — the app has no clipboard package); if that isn't
 * available it opens the share sheet with the code so it can still be copied
 * or sent.
 */
export async function copyCouponCode(code: string): Promise<CopyResult> {
  try {
    if (Clipboard && typeof Clipboard.setString === 'function') {
      Clipboard.setString(code);
      return 'copied';
    }
  } catch {
    /* fall through to the share sheet */
  }
  try {
    const res = await Share.share({ message: code });
    return res.action === Share.dismissedAction ? 'failed' : 'shared';
  } catch {
    return 'failed';
  }
}
