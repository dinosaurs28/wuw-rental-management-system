import { create } from 'zustand';
import type { PricingDetails } from '../types/api';

export interface EmployeeBookingCustomer {
  publicId: string;
  name: string;
  phone: string | null;
}

export interface EmployeeBookingVehicle {
  groupKey: string;
  // Set when staff picked one car by its registration number (client item 5):
  // the booking is created for exactly this car (vehicles: [publicId]) instead
  // of any free unit of groupKey.
  vehiclePublicId?: string | null;
  regNo?: string | null;
  make: string;
  model: string;
  category: string;
  branch: string;
  deposit: number;
  dailyPrice: number | null;
  image: string | null;
  pricingDetails: PricingDetails | null;
  advancePayAmount: number;
}

export type WalkinPlan = 'STANDARD' | 'MONTHLY';

interface EmployeeBookingState {
  customer: EmployeeBookingCustomer | null;
  start: string | null; // ISO datetime
  end: string | null; // ISO datetime
  vehicle: EmployeeBookingVehicle | null;
  // CustomerKyc.publicId to attach, sent as customer_kyc_id. Optional (X2): null = none.
  customerKycId: string | null;
  // QrPhoto.publicId of the customer's current QR code photo (#4); required
  // before the summary, sent as qr_photo_id on create.
  qrPhotoId: string | null;
  // Rental plan (#15/#17): MONTHLY = the counter monthly plan (30–180 days),
  // sent as plan on create. STANDARD bookings follow the 15-day rule.
  plan: WalkinPlan;

  setCustomer: (c: EmployeeBookingCustomer) => void;
  setDates: (start: string, end: string) => void;
  setPlan: (plan: WalkinPlan) => void;
  setVehicle: (v: EmployeeBookingVehicle) => void;
  setCustomerKycId: (id: string | null) => void;
  setQrPhotoId: (id: string | null) => void;
  reset: () => void;
}

/**
 * Holds the in-progress employee walk-in booking across the flow:
 * customer → vehicle + dates → KYC → summary/hold/pay.
 * Cleared on reset() once the booking is created or abandoned.
 */
export const useEmployeeBookingStore = create<EmployeeBookingState>((set) => ({
  customer: null,
  start: null,
  end: null,
  vehicle: null,
  customerKycId: null,
  qrPhotoId: null,
  plan: 'STANDARD',

  setCustomer: (customer) => set({ customer }),
  setDates: (start, end) => set({ start, end }),
  setPlan: (plan) => set({ plan }),
  setVehicle: (vehicle) => set({ vehicle }),
  setCustomerKycId: (customerKycId) => set({ customerKycId }),
  setQrPhotoId: (qrPhotoId) => set({ qrPhotoId }),
  reset: () =>
    set({ customer: null, start: null, end: null, vehicle: null, customerKycId: null, qrPhotoId: null, plan: 'STANDARD' }),
}));
