import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { getCurrentTime } from "@/utils/formatters";
import type { CounterProof } from "@/lib/counterPayment";

interface Pricing {
  baseTotal: number;
  discountAmount: number;
  deposit: number;
  finalTotal: number;
}

/** ONLINE = Razorpay checkout; the rest are counter methods (#3 / #11). */
export type EmployeePaymentType = "CASH" | "ONLINE" | "UPI" | "SPLIT" | "CREDIT";

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
  /** UPI / split walk-ins: the photo of the customer's payment screen (#3). */
  upiProof: CounterProof | null;
  /** Split walk-ins: the cash part as typed — the server takes the rest as UPI. */
  splitCash: string;
  /** Credit walk-ins: what was taken from the customer until it is cleared (#11). */
  collateral: string;
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
  setUpiProof: (proof: CounterProof | null) => void;
  setSplitCash: (cash: string) => void;
  setCollateral: (note: string) => void;
  /** Drops the photo, split and collateral (another customer / a new booking). */
  clearCounterPayment: () => void;
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
      upiProof: null,
      splitCash: "",
      collateral: "",
      pricing: null,
      customerKycId: null,

      setVehicle: (vehicleId) => set({ selectedVehicleId: vehicleId, selectedGroupKey: null }),
      setGroupKey: (groupKey) => set({ selectedGroupKey: groupKey, selectedVehicleId: null }),
      setDates: (start, end) => set({ startDate: start, endDate: end }),
      setStartTime: (time) => set({ startTime: time }),
      setEndTime: (time) => set({ endTime: time }),
      setPlan: (plan) => set({ plan }),
      setPaymentType: (type) => set({ paymentType: type }),
      setUpiProof: (proof) => set({ upiProof: proof }),
      setSplitCash: (cash) => set({ splitCash: cash }),
      setCollateral: (note) => set({ collateral: note }),
      clearCounterPayment: () => set({ upiProof: null, splitCash: "", collateral: "" }),
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
          upiProof: null,
          splitCash: "",
          collateral: "",
          pricing: null,
          customerKycId: null,
        }),
    }),
    {
      name: "employee-booking-storage",
      partialize: (state) => {
        // Payment photo, split and collateral stay in memory only so they can't carry
        // over to another customer's booking
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { startTime, endTime, upiProof, splitCash, collateral, ...rest } = state;
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
