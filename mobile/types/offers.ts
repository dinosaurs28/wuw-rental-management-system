// Offer posters for the home hero slider (#15) — GET /api/public/offers.
// Times are ISO-8601 instants (render in IST). Numbers arrive as numbers.

export type OfferLinkType = 'VEHICLE_GROUP' | 'VEHICLE';

export interface OfferCoupon {
  code: string;
  discountType: 'PERCENTAGE' | 'FLAT';
  /** 20 = 20 % or ₹20 */
  value: number;
  /** ₹ cap for PERCENTAGE coupons */
  maxDiscountCap: number | null;
  /** The coupon's own end (IST end of day). */
  validUntil: string;
}

export interface PublicOffer {
  publicId: string;
  title: string;
  subtitle: string | null;
  /** Public WebP, landscape (aspect 1.5–2.1, ~16:9). */
  imageUrl: string;
  /** Only when the coupon is usable right now; null together with `coupon`. */
  couponCode: string | null;
  coupon: OfferCoupon | null;
  /** Button text. With linkTarget → that vehicle; without → the vehicles list. */
  ctaLabel: string | null;
  /** Vehicle group key or vehicle publicId; null when it no longer exists. */
  linkTarget: string | null;
  linkType: OfferLinkType | null;
  /** null = a poster for every branch. */
  branch: { publicId: string; name: string } | null;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
}

export interface PublicOffersResponse {
  success: boolean;
  serverTime: string;
  data: PublicOffer[];
}
