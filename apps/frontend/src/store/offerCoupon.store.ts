import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// "Use code" on an offer poster (#15): the code waits here (localStorage, so it
// survives sign-in and new tabs) until the checkout coupon field picks it up.
// It is only a prefill — the normal coupon check decides whether it applies.

interface OfferCouponState {
  code: string | null;
  /** The coupon's own end (ISO); the saved code is dropped after it. */
  validUntil: string | null;
  /** Poster title, for the checkout hint. */
  offerTitle: string | null;
  saveCode: (code: string, opts?: { validUntil?: string | null; offerTitle?: string | null }) => void;
  clearCode: () => void;
}

const EMPTY = { code: null, validUntil: null, offerTitle: null };

export const useOfferCouponStore = create<OfferCouponState>()(
  persist(
    (set) => ({
      ...EMPTY,
      saveCode: (code, opts) =>
        set({
          code: code.trim().toUpperCase(),
          validUntil: opts?.validUntil ?? null,
          offerTitle: opts?.offerTitle ?? null,
        }),
      clearCode: () => set(EMPTY),
    }),
    {
      name: "wuw-offer-coupon",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ code, validUntil, offerTitle }) => ({ code, validUntil, offerTitle }),
    },
  ),
);

/** The saved code while its coupon is still within its validity, else null. */
export const activeOfferCode = (
  state: Pick<OfferCouponState, "code" | "validUntil">,
  now: number = Date.now(),
): string | null => {
  if (!state.code) return null;
  if (state.validUntil && new Date(state.validUntil).getTime() <= now) return null;
  return state.code;
};
