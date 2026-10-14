import apiClient from "@/lib/axios";
import type {
  SpecialPricingListFilter,
  SpecialPricingScopeValue,
  SpecialPricingStatus,
} from "@repo/schemas";

/**
 * Festival pricing rules (e.g. "Dussehra", 20–22 Oct, +10% on every vehicle):
 * priced blocks with at least half their time on the dates are billed at
 * rent × (1 + percent / 100). Bookings already made keep their prices.
 */
export interface SpecialPricingRule {
  id: number;
  publicId: string;
  branchId: number;
  name: string;
  /** IST calendar dates (YYYY-MM-DD), both inclusive */
  startDate: string;
  endDate: string;
  days: number;
  /** −90 … +300; negative = a festival discount */
  percent: number;
  scope: SpecialPricingScopeValue;
  categoryIds: number[];
  vehicleIds: number[];
  active: boolean;
  status: SpecialPricingStatus;
  categories: { id: number; name: string }[];
  vehicles: { id: number; regNo: string; make: string; model: string }[];
  createdBy: { name: string } | null;
  updatedBy: { name: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** What the scope pickers offer: the branch's categories in use and its vehicles. */
export interface SpecialPricingOptions {
  categories: { id: number; name: string; vehicleCount: number }[];
  vehicles: { id: number; regNo: string; make: string; model: string; categoryId: number; categoryName: string }[];
}

export interface SpecialPricingDraft {
  name: string;
  startDate: string;
  endDate: string;
  percent: number;
  scope: SpecialPricingScopeValue;
  categoryIds: number[];
  vehicleIds: number[];
  active: boolean;
}

/** A draft's 24-hour rents on one festival day, before → after (incl. GST). */
export interface SpecialPricingPreview {
  day: string;
  vehiclesInScope: number;
  samples: { vehicleId: number; name: string; category: string; regNo: string; before: number; after: number }[];
}

/** Whose rules: the manager's own branch, or the branch an admin picked. */
export type SpecialPricingPortal = { kind: "manager" } | { kind: "admin"; branchId: number };

const base = (portal: SpecialPricingPortal) =>
  portal.kind === "manager" ? "/branchManager/pricing/special-rules" : "/admin/pricing/special-rules";
const branchOf = (portal: SpecialPricingPortal) => (portal.kind === "admin" ? { branchId: portal.branchId } : {});

export const specialPricingApi = {
  list: async (portal: SpecialPricingPortal, filter: SpecialPricingListFilter): Promise<SpecialPricingRule[]> => {
    const res = await apiClient.get(base(portal), { params: { ...branchOf(portal), filter } });
    return res.data.data ?? [];
  },
  options: async (portal: SpecialPricingPortal): Promise<SpecialPricingOptions> => {
    const res = await apiClient.get(`${base(portal)}/options`, { params: branchOf(portal) });
    return res.data.data;
  },
  preview: async (
    portal: SpecialPricingPortal,
    draft: Pick<SpecialPricingDraft, "startDate" | "endDate" | "percent" | "scope" | "categoryIds" | "vehicleIds">,
  ): Promise<SpecialPricingPreview> => {
    const res = await apiClient.post(`${base(portal)}/preview`, { ...draft, ...branchOf(portal) });
    return res.data.data;
  },
  create: async (portal: SpecialPricingPortal, draft: SpecialPricingDraft): Promise<SpecialPricingRule> => {
    const res = await apiClient.post(base(portal), { ...draft, ...branchOf(portal) });
    return res.data.data;
  },
  update: async (
    portal: SpecialPricingPortal,
    publicId: string,
    patch: Partial<SpecialPricingDraft>,
  ): Promise<SpecialPricingRule> => {
    const res = await apiClient.patch(`${base(portal)}/${publicId}`, patch);
    return res.data.data;
  },
  remove: async (portal: SpecialPricingPortal, publicId: string): Promise<void> => {
    await apiClient.delete(`${base(portal)}/${publicId}`);
  },
};
