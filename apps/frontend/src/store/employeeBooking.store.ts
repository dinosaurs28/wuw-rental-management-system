import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getCurrentTime } from "@/utils/formatters";

interface Pricing {
  baseTotal: number;
  discountAmount: number;
  deposit: number;
  finalTotal: number;
}

interface EmployeeBookingState {
  selectedVehicleId: string | null;
  selectedGroupKey: string | null;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string;
  endTime: string;
  paymentType: "CASH" | "ONLINE";
  pricing: Pricing | null;
  customerKycId: string | null;

  // Actions
  setVehicle: (vehicleId: string) => void;
  setGroupKey: (groupKey: string | null) => void;
  setDates: (start: Date, end: Date) => void;
  setStartTime: (time: string) => void;
  setEndTime: (time: string) => void;
  setPaymentType: (type: "CASH" | "ONLINE") => void;
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
      paymentType: "CASH",
      pricing: null,
      customerKycId: null,

      setVehicle: (vehicleId) => set({ selectedVehicleId: vehicleId, selectedGroupKey: null }),
      setGroupKey: (groupKey) => set({ selectedGroupKey: groupKey, selectedVehicleId: null }),
      setDates: (start, end) => set({ startDate: start, endDate: end }),
      setStartTime: (time) => set({ startTime: time }),
      setEndTime: (time) => set({ endTime: time }),
      setPaymentType: (type) => set({ paymentType: type }),
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
          paymentType: "CASH",
          pricing: null,
          customerKycId: null,
        }),
    }),
    {
      name: "employee-booking-storage",
      partialize: (state) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { startTime, endTime, ...rest } = state;
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
