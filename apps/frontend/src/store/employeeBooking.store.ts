import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface Pricing {
  baseTotal: number;
  discountAmount: number;
  deposit: number;
  finalTotal: number;
}

interface EmployeeBookingState {
  selectedVehicleId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  startTime: string;
  endTime: string;
  paymentType: "CASH" | "ONLINE";
  pricing: Pricing | null;
  customerKycId: string | null;

  // Actions
  setVehicle: (vehicleId: string) => void;
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
      startDate: null,
      endDate: null,
      startTime: "10:00",
      endTime: "10:00",
      paymentType: "CASH",
      pricing: null,
      customerKycId: null,

      setVehicle: (vehicleId) => set({ selectedVehicleId: vehicleId }),
      setDates: (start, end) => set({ startDate: start, endDate: end }),
      setStartTime: (time) => set({ startTime: time }),
      setEndTime: (time) => set({ endTime: time }),
      setPaymentType: (type) => set({ paymentType: type }),
      setPricing: (pricing) => set({ pricing }),
      setCustomerKycId: (id) => set({ customerKycId: id }),
      reset: () =>
        set({
          selectedVehicleId: null,
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
