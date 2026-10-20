import apiClient from "@/lib/axios";
import type { BookingLockListFilter, BookingLockScopeValue, BookingLockStatus } from "@repo/schemas";

/**
 * Booking locks (client, Oct 2026: "create a booking lock for a Window"): the
 * branch manager keeps cars from being booked for a date-time window — the
 * whole branch, some vehicles or some vehicle groups. Existing bookings are not
 * changed; customers only see the cars as unavailable.
 */
export interface BookingLock {
  publicId: string;
  branchId: number;
  startAt: string;
  endAt: string;
  reason: string;
  scope: BookingLockScopeValue;
  vehicleIds: number[];
  groupKeys: string[];
  /** Hidden from customers only — staff walk-ins still allowed. */
  customersOnly: boolean;
  status: BookingLockStatus;
  vehicles: { id: number; regNo: string; make: string; model: string }[];
  groups: { key: string; make: string; model: string; categoryId: number; categoryName: string | null }[];
  createdBy: { name: string } | null;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: { name: string } | null;
}

/** What the dialog offers: the branch's vehicles and vehicle groups (make + model + category). */
export interface BookingLockOptions {
  vehicles: { id: number; regNo: string; make: string; model: string; categoryId: number; categoryName: string }[];
  groups: { key: string; make: string; model: string; categoryId: number; categoryName: string; vehicleCount: number }[];
}

/** An existing CONFIRMED / PICKED_UP booking inside the window (kept as it is). */
export interface BookingLockOverlap {
  bookingPublicId: string;
  status: string;
  startAt: string;
  endAt: string;
  customerName: string | null;
  vehicles: { regNo: string; make: string; model: string }[];
}

export interface BookingLockPreview {
  /** Vehicles the lock would cover now. */
  vehicleCount: number;
  overlapping: BookingLockOverlap[];
}

export interface BookingLockDraft {
  startAt: string;
  endAt: string;
  reason: string;
  scope: BookingLockScopeValue;
  vehicleIds: number[];
  groupKeys: string[];
  customersOnly: boolean;
  acknowledgeOverlaps?: boolean;
}

/** Whose locks: the manager's own branch, or the branch an admin picked. */
export type BookingLockPortal = { kind: "manager" } | { kind: "admin"; branchId: number };

const base = (portal: BookingLockPortal) => (portal.kind === "manager" ? "/branchManager/booking-locks" : "/admin/booking-locks");
const branchOf = (portal: BookingLockPortal) => (portal.kind === "admin" ? { branchId: portal.branchId } : {});

export const bookingLockApi = {
  list: async (portal: BookingLockPortal, filter: BookingLockListFilter): Promise<BookingLock[]> => {
    const res = await apiClient.get(base(portal), { params: { ...branchOf(portal), filter } });
    return res.data.data ?? [];
  },
  options: async (portal: BookingLockPortal): Promise<BookingLockOptions> => {
    const res = await apiClient.get(`${base(portal)}/options`, { params: branchOf(portal) });
    return res.data.data;
  },
  preview: async (portal: BookingLockPortal, draft: BookingLockDraft): Promise<BookingLockPreview> => {
    const res = await apiClient.post(`${base(portal)}/preview`, { ...draft, ...branchOf(portal) });
    return res.data.data;
  },
  create: async (portal: BookingLockPortal, draft: BookingLockDraft): Promise<BookingLock> => {
    const res = await apiClient.post(base(portal), { ...draft, ...branchOf(portal) });
    return res.data.data;
  },
  cancel: async (portal: BookingLockPortal, publicId: string): Promise<BookingLock> => {
    const res = await apiClient.post(`${base(portal)}/${publicId}/cancel`, {}, { params: branchOf(portal) });
    return res.data.data;
  },
};
