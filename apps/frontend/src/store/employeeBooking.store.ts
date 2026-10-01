import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getCurrentTime } from "@/utils/formatters";

interface Pricing {
  baseTotal: number;
  discountAmount: number;
  deposit: number;
  finalTotal: number;
}

export type EmployeePaymentType = "CASH" | "ONLINE" | "UPI";

/** Counter plan (#15/#17): MONTHLY = 30–180 days, stored as rentalPeriodType MONTHLY. */
export type EmployeeBookingPlan = "STANDARD" | "MONTHLY";

interface EmployeeBookingState {
  selectedVehicleId: string | null;
  selectedGroupKey: string | null;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string;
  endTime: string;
  plan: EmployeeBookingPlan;
  paymentType: EmployeePaymentType;
  /** UPI (UTR) walk-ins: the 12-digit UTR the customer paid with. */
  utr: string;
  pricing: Pricing | null;
  customerKycId: string | null;

  // Actions
  setVehicle: (vehicleId: string) => void;
  setGroupKey: (groupKey: string | null) => void;
  setDates: (start: Date, end: Date) => void;
  setStartTime: (time: string) => void;
  setEndTime: (time: string) => void;
  setPlan: (plan: EmployeeBookingPlan) => void;
  setPaymentType: (type: EmployeePaymentType) => void;
  setUtr: (utr: string) => void;
  setPricing: (pricing: Pricing) => void;
  setCustomerKycId: (id: string | null) => void;
  reset: () => void;
}

export const useEmployeeBookingStore = create<EmployeeBookingState>()(
  persist(
    (set) => ({
      selectedVehicleId: null,
      selectedGroupKey: null,
      startDate: null,
      endDate: null,
      startTime: getCurrentTime(),
      endTime: getCurrentTime(),
      plan: "STANDARD",
      paymentType: "CASH",
      utr: "",
      pricing: null,
      customerKycId: null,

      setVehicle: (vehicleId) => set({ selectedVehicleId: vehicleId, selectedGroupKey: null }),
      setGroupKey: (groupKey) => set({ selectedGroupKey: groupKey, selectedVehicleId: null }),
      setDates: (start, end) => set({ startDate: start, endDate: end }),
      setStartTime: (time) => set({ startTime: time }),
      setEndTime: (time) => set({ endTime: time }),
      setPlan: (plan) => set({ plan }),
      setPaymentType: (type) => set({ paymentType: type }),
      setUtr: (utr) => set({ utr }),
      setPricing: (pricing) => set({ pricing }),
      setCustomerKycId: (id) => set({ customerKycId: id }),
      reset: () =>
        set({
          selectedVehicleId: null,
          selectedGroupKey: null,
          startDate: null,
          endDate: null,
          startTime: "10:00",
          endTime: "10:00",
          plan: "STANDARD",
          paymentType: "CASH",
          utr: "",
          pricing: null,
          customerKycId: null,
        }),
    }),
    {
      name: "employee-booking-storage",
      partialize: (state) => {
        // UTR stays in memory only so it can't carry over to another customer's booking
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { startTime, endTime, utr, ...rest } = state;
        return rest;
      },
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          const str = sessionStorage.getItem(name);
          if (!str) return null;
          return JSON.parse(str, (key, value) => {
            if (key === "startDate" || key === "endDate") {
              return value ? new Date(value) : null;
            }
            return value;
          });
        },
        setItem: (name, value) => {
          sessionStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => sessionStorage.removeItem(name),
      })),
    },
  ),
);
