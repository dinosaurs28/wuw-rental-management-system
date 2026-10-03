import apiClient from "@/lib/axios";

// Offer posters (#15): the landing hero slider (public) and the Branch
// Manager's "Offers & banners" page. Times are ISO instants; render in IST.

export type OfferLinkType = "VEHICLE_GROUP" | "VEHICLE";
export type OfferStatus = "LIVE" | "SCHEDULED" | "EXPIRED" | "INACTIVE";
export type OfferDiscountType = "PERCENTAGE" | "FLAT";

export interface PublicOfferCoupon {
  code: string;
  discountType: OfferDiscountType;
  /** 20 = 20 % or ₹20 */
  value: number;
  maxDiscountCap: number | null;
  /** The coupon's own end (ISO). */
  validUntil: string;
}

export interface PublicOffer {
  publicId: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  /** Only set while the coupon is usable right now (null together with `coupon`). */
  couponCode: string | null;
  coupon: PublicOfferCoupon | null;
  ctaLabel: string | null;
  /** Vehicle group key or vehicle publicId; null when it no longer exists. */
  linkTarget: string | null;
  linkType: OfferLinkType | null;
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

export interface ManagerOfferCoupon {
  publicId: string;
  code: string;
  name: string;
  discountType: OfferDiscountType;
  value: number;
  maxDiscountCap: number | null;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

export type OfferCouponStatus =
  | { valid: true }
  | { valid: false; code: string; message: string };

export interface ManagerOffer {
  publicId: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  image: { publicId: string; url: string; mime: string; size: number };
  /** Stored code — shown to the BM even when it is no longer usable. */
  couponCode: string | null;
  coupon: ManagerOfferCoupon | null;
  /** Live re-check of the stored code; null = no coupon. */
  couponStatus: OfferCouponStatus | null;
  /** Non-blocking note about the coupon (e.g. first-time customers only). */
  couponWarning: string | null;
  ctaLabel: string | null;
  linkTarget: string | null;
  linkType: OfferLinkType | null;
  linkLabel: string | null;
  /** False when the linked vehicle / group no longer exists (the public hides the link). */
  linkValid: boolean;
  startsAt: string;
  endsAt: string;
  sortOrder: number;
  isActive: boolean;
  status: OfferStatus;
  branch: { publicId: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type OfferCounts = Record<OfferStatus | "total", number>;

export interface ManagerOffersResponse {
  success: boolean;
  data: ManagerOffer[];
  counts: OfferCounts;
}

/** A coupon a poster at this branch may advertise (GET /offers/coupons). */
export interface PosterCouponOption {
  publicId: string;
  code: string;
  name: string;
  discountType: OfferDiscountType;
  value: number;
  maxDiscountCap: number | null;
  startDate: string;
  endDate: string;
  scope: "GLOBAL" | "BRANCH";
  warning: string | null;
}

export interface OfferLinkGroup {
  groupKey: string;
  make: string;
  model: string;
  category: string;
  vehicleCount: number;
  label: string;
}

export interface OfferLinkVehicle {
  publicId: string;
  make: string;
  model: string;
  regNo: string;
  category: string;
  label: string;
}

export interface OfferLinkTargets {
  groups: OfferLinkGroup[];
  vehicles: OfferLinkVehicle[];
}

/**
 * Fields of a poster save. Dates are IST wall time "YYYY-MM-DDTHH:mm".
 * On update, only the keys present are sent; "" clears an optional field.
 */
export interface OfferSaveFields {
  title?: string;
  subtitle?: string;
  couponCode?: string;
  ctaLabel?: string;
  linkTarget?: string;
  startsAt?: string;
  endsAt?: string;
  sortOrder?: number;
  isActive?: boolean;
}

const toFormData = (fields: OfferSaveFields, image?: File | null) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    fd.append(key, String(value));
  }
  if (image) fd.append("image", image);
  return fd;
};

/** Hero slider — no auth. `branchPublicId` limits it to that branch's + global posters. */
export const offersPublicService = {
  async list(branchPublicId?: string | null): Promise<PublicOffersResponse> {
    const res = await apiClient.get("/public/offers", {
      params: branchPublicId ? { branch: branchPublicId } : undefined,
    });
    return res.data;
  },
};

/** "Offers & banners" — the BM's own branch only. */
export const managerOffersService = {
  async list(status?: OfferStatus): Promise<ManagerOffersResponse> {
    const res = await apiClient.get("/branchManager/offers", {
      params: status ? { status } : undefined,
    });
    return res.data;
  },

  async get(publicId: string): Promise<{ success: boolean; data: ManagerOffer }> {
    const res = await apiClient.get(`/branchManager/offers/${publicId}`);
    return res.data;
  },

  async coupons(): Promise<{ success: boolean; data: PosterCouponOption[] }> {
    const res = await apiClient.get("/branchManager/offers/coupons");
    return res.data;
  },

  async linkTargets(): Promise<{ success: boolean; data: OfferLinkTargets }> {
    const res = await apiClient.get("/branchManager/offers/link-targets");
    return res.data;
  },

  /** multipart — the poster image is required. */
  async create(fields: OfferSaveFields, image: File): Promise<{ success: boolean; message: string; data: ManagerOffer }> {
    const res = await apiClient.post("/branchManager/offers", toFormData(fields, image), {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
    });
    return res.data;
  },

  /** multipart when replacing the image, JSON otherwise. */
  async update(
    publicId: string,
    fields: OfferSaveFields,
    image?: File | null,
  ): Promise<{ success: boolean; message: string; data: ManagerOffer }> {
    const res = image
      ? await apiClient.patch(`/branchManager/offers/${publicId}`, toFormData(fields, image), {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 60000,
        })
      : await apiClient.patch(`/branchManager/offers/${publicId}`, fields);
    return res.data;
  },

  async remove(publicId: string): Promise<{ success: boolean; message: string }> {
    const res = await apiClient.delete(`/branchManager/offers/${publicId}`);
    return res.data;
  },
};
