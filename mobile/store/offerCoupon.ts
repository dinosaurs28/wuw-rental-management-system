import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

// #15 — the coupon a customer picked with "Use code" on a home offer poster.
// Checkout prefills (and checks) it in the coupon field; the server's normal
// coupon validation decides whether it applies to the chosen car and dates.
const OFFER_COUPON_KEY = 'wuw_offer_coupon';

export interface SavedOfferCoupon {
  /** Upper-case coupon code. */
  code: string;
  /** The coupon's own end (ISO) — a saved code is dropped once it has passed. */
  validUntil: string | null;
  savedAt: string;
}

interface OfferCouponState {
  coupon: SavedOfferCoupon | null;
  isLoaded: boolean;
  load: () => Promise<void>;
  save: (code: string, validUntil?: string | null) => void;
  clear: () => void;
}

function isExpired(c: SavedOfferCoupon, now = Date.now()): boolean {
  if (!c.validUntil) return false;
  const t = new Date(c.validUntil).getTime();
  return !isNaN(t) && t <= now;
}

function parse(raw: string | null): SavedOfferCoupon | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v.code !== 'string' || !v.code.trim()) return null;
    return {
      code: v.code.trim().toUpperCase(),
      validUntil: typeof v.validUntil === 'string' ? v.validUntil : null,
      savedAt: typeof v.savedAt === 'string' ? v.savedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export const useOfferCouponStore = create<OfferCouponState>((set, get) => ({
  coupon: null,
  isLoaded: false,

  // Safe to call from every screen that needs it: reads storage once.
  load: async () => {
    if (get().isLoaded) return;
    let coupon: SavedOfferCoupon | null = null;
    try {
      coupon = parse(await SecureStore.getItemAsync(OFFER_COUPON_KEY));
    } catch {
      coupon = null;
    }
    // A save made while storage was being read wins.
    if (get().isLoaded) return;
    if (coupon && isExpired(coupon)) {
      coupon = null;
      SecureStore.deleteItemAsync(OFFER_COUPON_KEY).catch(() => {});
    }
    set({ coupon, isLoaded: true });
  },

  save: (code, validUntil = null) => {
    const coupon: SavedOfferCoupon = {
      code: code.trim().toUpperCase(),
      validUntil: validUntil ?? null,
      savedAt: new Date().toISOString(),
    };
    set({ coupon, isLoaded: true });
    SecureStore.setItemAsync(OFFER_COUPON_KEY, JSON.stringify(coupon)).catch(() => {});
  },

  clear: () => {
    set({ coupon: null, isLoaded: true });
    SecureStore.deleteItemAsync(OFFER_COUPON_KEY).catch(() => {});
  },
}));

/** The saved code, or null when there is none or it has expired since it was saved. */
export function activeOfferCoupon(c: SavedOfferCoupon | null): SavedOfferCoupon | null {
  return c && !isExpired(c) ? c : null;
}
