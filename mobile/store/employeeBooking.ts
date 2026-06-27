import { create } from 'zustand';
import type { PricingDetails } from '../types/api';

export interface EmployeeBookingCustomer {
  publicId: string;
  name: string;
  phone: string | null;
}

export interface EmployeeBookingVehicle {
  groupKey: string;
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

interface EmployeeBookingState {
  customer: EmployeeBookingCustomer | null;
  start: string | null; // ISO datetime
  end: string | null; // ISO datetime
  vehicle: EmployeeBookingVehicle | null;
  customerKycId: string | null;

  setCustomer: (c: EmployeeBookingCustomer) => void;
  setDates: (start: string, end: string) => void;
  setVehicle: (v: EmployeeBookingVehicle) => void;
  setCustomerKycId: (id: string | null) => void;
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

  setCustomer: (customer) => set({ customer }),
  setDates: (start, end) => set({ start, end }),
  setVehicle: (vehicle) => set({ vehicle }),
  setCustomerKycId: (customerKycId) => set({ customerKycId }),
  reset: () => set({ customer: null, start: null, end: null, vehicle: null, customerKycId: null }),
}));
