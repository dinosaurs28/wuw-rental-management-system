import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface VehicleRentalState {
  // Vehicle info
  selectedVehicleId: string | null;
  name: string | null;
  model: string | null;
  make: string | null;
  vehicleImages: string[];
  category: string | null;
  branch: string | null;

  // Date selection (stored as ISO strings for proper serialization)
  startDate: string | null;
  endDate: string | null;
  startTime: string;
  endTime: string;
  dateSelectionTimestamp: number | null;

  // Pricing
  rentalDays: number;
  pricePerDay: number;
  totalPrice: number;
  deposit: number;

  // API-returned pricing details (from vehicle details endpoint with dates)
  apiBasePrice: number;
  apiDurationDiscountAmount: number;
  apiDurationDiscountPercent: number;
  apiTaxAmount: number;
  apiFinalTotal: number;

  // Booking state
  selectedKycFilePublicId: string | null;
  paymentType: "CASH" | "ONLINE" | null;
  paymentFlow: "FULL" | "ADVANCE";
  advancePayAmount: number;
  couponCode: string | null;
  couponDiscountAmount: number;

  // Booking response (after API call)
  holdId: string | null;
  transactionId: string | null;
  paymentURL: string | null;
  encryptedFinalPrice: string | null;
  grandBaseTotal: number;
  grandDiscountTotal: number;
  grandDeposit: number;
  grandFinalTotal: number;

  // Actions
  setVehicleId: (vehicleId: string | null) => void;
  setVehicleDetails: (details: {
    name: string;
    model: string;
    make: string;
  }) => void;
  setVehicleFullDetails: (details: {
    name: string;
    model: string;
    make: string;
    images: string[];
    category: string;
    branch: string;
  }) => void;
  setStartDate: (date: Date | null) => void;
  setEndDate: (date: Date | null) => void;
  setStartTime: (time: string) => void;
  setEndTime: (time: string) => void;
  setDateRange: (startDate: Date | null, endDate: Date | null) => void;
  setPricePerDay: (price: number) => void;
  setDeposit: (deposit: number) => void;
  setApiPricingDetails: (details: {
    basePrice: number;
    durationDiscountAmount: number;
    durationDiscountPercent: number;
    taxAmount: number;
    finalTotal: number;
  }) => void;
  setSelectedKyc: (filePublicId: string | null) => void;
  setPaymentType: (type: "CASH" | "ONLINE" | null) => void;
  setPaymentFlow: (flow: "FULL" | "ADVANCE") => void;
  setAdvancePayAmount: (amount: number) => void;
  setCouponCode: (code: string | null, amount?: number) => void;
  setBookingResponse: (response: {
    holdId: string;
    transactionId: string;
    paymentURL: string | null;
    encryptedFinalPrice: string | null;
    grandBaseTotal: number;
    grandDiscountTotal: number;
    grandDeposit: number;
    grandFinalTotal: number;
  }) => void;
  calculateRentalDays: () => number;
  calculateTotalPrice: () => number;
  clearDates: () => void;
  clearVehicleSelection: () => void;
  clearBookingState: () => void;
  isDateRangeValid: () => boolean;
  hasValidDateSelection: () => boolean;
  getValidationErrors: () => string[];
  hasVehicleSelected: () => boolean;

  // Getters (convert ISO strings to Date objects)
  getStartDate: () => Date | null;
  getEndDate: () => Date | null;
}

// Constants
const MIN_RENTAL_DAYS = 1;
const MAX_RENTAL_DAYS = 30;

// Helper to check if date is valid
const isValidDate = (date: Date | null): boolean => {
  if (!date) return false;
  return date instanceof Date && !isNaN(date.getTime());
};

// Helper to check if date is in the past (ignoring time)
const isDateInPast = (dateStr: string): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(dateStr);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate < today;
};

// Helper to calculate days between two dates/times
// Based on 24-hour cycles: 24h = 1 day, 25h = 2 days
const calculateDaysBetween = (
  startDateStr: string | null,
  endDateStr: string | null,
  startTimeStr: string = "10:00",
  endTimeStr: string = "10:00",
): number => {
  if (!startDateStr || !endDateStr) return 0;

  // Combine local date and time strings
  // Note: We use the format YYYY-MM-DDTHH:mm to avoid timezone shifts during manual parsing
  const start = new Date(`${startDateStr}T${startTimeStr}`);
  const end = new Date(`${endDateStr}T${endTimeStr}`);

  // Validate dates
  if (!isValidDate(start) || !isValidDate(end)) return 0;

  // Duration in hours
  const diffTime = end.getTime() - start.getTime();
  const diffHours = diffTime / (1000 * 60 * 60);

  if (diffHours <= 0) return 0;

  // Use ceiling to count partial 24h blocks as full days
  const diffDays = Math.ceil(diffHours / 24);

  // Minimum 1 day rental
  return diffDays >= MIN_RENTAL_DAYS ? diffDays : 0;
};


// Helper to convert Date to local date string (YYYY-MM-DD format)
// Using local date format prevents timezone issues when converting to/from ISO
const toLocalDateString = (date: Date | null): string | null => {
  if (!date || !isValidDate(date)) return null;
  // Format as YYYY-MM-DD to preserve the selected date in local timezone
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const useVehicleRentalStore = create<VehicleRentalState>()(
  //@ts-ignore
  persist(
    (set, get) => ({
      // Initial state
      selectedVehicleId: null,
      name: null,
      model: null,
      make: null,
      vehicleImages: [],
      category: null,
      branch: null,
      startDate: null,
      endDate: null,
      startTime: "10:00",
      endTime: "10:00",
      dateSelectionTimestamp: null,
      rentalDays: 0,
      pricePerDay: 0,
      totalPrice: 0,
      deposit: 0,
      apiBasePrice: 0,
      apiDurationDiscountAmount: 0,
      apiDurationDiscountPercent: 0,
      apiTaxAmount: 0,
      apiFinalTotal: 0,
      selectedKycFilePublicId: null,
      paymentType: null,
      paymentFlow: "FULL",
      advancePayAmount: 0,
      couponCode: null,
      couponDiscountAmount: 0,
      holdId: null,
      transactionId: null,
      paymentURL: null,
      encryptedFinalPrice: null,
      grandBaseTotal: 0,
      grandDiscountTotal: 0,
      grandDeposit: 0,
      grandFinalTotal: 0,

      // Actions
      setVehicleId: (vehicleId) => set({ selectedVehicleId: vehicleId }),

      setVehicleDetails: (details) =>
        set({
          name: details.name,
          model: details.model,
          make: details.make,
        }),

      setVehicleFullDetails: (details) =>
        set({
          name: details.name,
          model: details.model,
          make: details.make,
          vehicleImages: details.images,
          category: details.category,
          branch: details.branch,
        }),

      setStartDate: (date) => {
        const state = get();
        const startDateStr = toLocalDateString(date);

        if (!startDateStr) {
          set({ startDate: null });
          return;
        }

        const rentalDays = calculateDaysBetween(
          startDateStr,
          state.endDate,
          state.startTime,
          state.endTime,
        );
        set({
          startDate: startDateStr,
          dateSelectionTimestamp: Date.now(),
          rentalDays,
          totalPrice: rentalDays * state.pricePerDay,
        });
      },

      setEndDate: (date) => {
        const state = get();
        const endDateStr = toLocalDateString(date);

        if (!endDateStr) {
          set({ endDate: null });
          return;
        }

        const rentalDays = calculateDaysBetween(
          state.startDate,
          endDateStr,
          state.startTime,
          state.endTime,
        );
        set({
          endDate: endDateStr,
          dateSelectionTimestamp: Date.now(),
          rentalDays,
          totalPrice: rentalDays * state.pricePerDay,
        });
      },

      setStartTime: (time) => {
        const state = get();
        const rentalDays = calculateDaysBetween(
          state.startDate,
          state.endDate,
          time,
          state.endTime,
        );
        set({
          startTime: time,
          rentalDays,
          totalPrice: rentalDays * state.pricePerDay,
        });
      },

      setEndTime: (time) => {
        const state = get();
        const rentalDays = calculateDaysBetween(
          state.startDate,
          state.endDate,
          state.startTime,
          time,
        );
        set({
          endTime: time,
          rentalDays,
          totalPrice: rentalDays * state.pricePerDay,
        });
      },

      setDateRange: (startDate, endDate) => {
        const state = get();
        const startDateStr = toLocalDateString(startDate);
        const endDateStr = toLocalDateString(endDate);
        const rentalDays = calculateDaysBetween(
          startDateStr,
          endDateStr,
          state.startTime,
          state.endTime,
        );
        set({
          startDate: startDateStr,
          endDate: endDateStr,
          dateSelectionTimestamp: Date.now(),
          rentalDays,
          totalPrice: rentalDays * state.pricePerDay,
        });
      },

      setPricePerDay: (price) => {
        const state = get();
        const validPrice = Math.max(0, price);
        set({
          pricePerDay: validPrice,
          totalPrice: state.rentalDays * validPrice,
        });
      },

      setDeposit: (deposit) => set({ deposit: Math.max(0, deposit) }),

      setApiPricingDetails: (details) =>
        set({
          apiBasePrice: details.basePrice,
          apiDurationDiscountAmount: details.durationDiscountAmount,
          apiDurationDiscountPercent: details.durationDiscountPercent,
          apiTaxAmount: details.taxAmount,
          apiFinalTotal: details.finalTotal,
        }),

      setSelectedKyc: (filePublicId) =>
        set({ selectedKycFilePublicId: filePublicId }),

      setPaymentType: (type) => set({ paymentType: type }),

      setPaymentFlow: (flow) => set({ paymentFlow: flow }),

      setAdvancePayAmount: (amount) => set({ advancePayAmount: Math.max(0, amount) }),

      setCouponCode: (code, amount = 0) => set({ couponCode: code, couponDiscountAmount: amount }),

      setBookingResponse: (response) =>
        set({
          holdId: response.holdId,
          transactionId: response.transactionId,
          paymentURL: response.paymentURL,
          encryptedFinalPrice: response.encryptedFinalPrice,
          grandBaseTotal: response.grandBaseTotal,
          grandDiscountTotal: response.grandDiscountTotal,
          grandDeposit: response.grandDeposit,
          grandFinalTotal: response.grandFinalTotal,
        }),

      calculateRentalDays: () => {
        const { startDate, endDate, startTime, endTime } = get();
        return calculateDaysBetween(startDate, endDate, startTime, endTime);
      },

      calculateTotalPrice: () => {
        const { rentalDays, pricePerDay } = get();
        return rentalDays * pricePerDay;
      },

      clearDates: () =>
        set({
          startDate: null,
          endDate: null,
          startTime: "10:00",
          endTime: "10:00",
          dateSelectionTimestamp: null,
          rentalDays: 0,
          totalPrice: 0,
        }),

      clearVehicleSelection: () =>
        set({
          selectedVehicleId: null,
          name: null,
          model: null,
          make: null,
          vehicleImages: [],
          category: null,
          branch: null,
          startDate: null,
          endDate: null,
          startTime: "10:00",
          endTime: "10:00",
          dateSelectionTimestamp: null,
          rentalDays: 0,
          pricePerDay: 0,
          totalPrice: 0,
          deposit: 0,
          apiBasePrice: 0,
          apiDurationDiscountAmount: 0,
          apiDurationDiscountPercent: 0,
          apiTaxAmount: 0,
          apiFinalTotal: 0,
          selectedKycFilePublicId: null,
          paymentType: null,
          holdId: null,
          transactionId: null,
          paymentURL: null,
          encryptedFinalPrice: null,
          grandBaseTotal: 0,
          grandDiscountTotal: 0,
          grandDeposit: 0,
          grandFinalTotal: 0,
        }),

      clearBookingState: () =>
        set({
          selectedKycFilePublicId: null,
          paymentType: null,
          paymentFlow: "FULL",
          advancePayAmount: 0,
          couponCode: null,
          couponDiscountAmount: 0,
          holdId: null,
          transactionId: null,
          paymentURL: null,
          encryptedFinalPrice: null,
          grandBaseTotal: 0,
          grandDiscountTotal: 0,
          grandDeposit: 0,
          grandFinalTotal: 0,
        }),

      isDateRangeValid: () => {
        const { startDate, endDate } = get();
        if (!startDate || !endDate) return false;

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (!isValidDate(start) || !isValidDate(end)) return false;

        return start <= end;
      },

      hasValidDateSelection: () => {
        const { startDate, endDate, rentalDays } = get();
        if (!startDate || !endDate) return false;

        if (!get().isDateRangeValid()) return false;

        if (isDateInPast(startDate)) return false;

        if (rentalDays < MIN_RENTAL_DAYS || rentalDays > MAX_RENTAL_DAYS) {
          return false;
        }

        return true;
      },

      getValidationErrors: () => {
        const { startDate, endDate, rentalDays } = get();
        const errors: string[] = [];

        if (!startDate) {
          errors.push("Please select a start date");
        }
        if (!endDate) {
          errors.push("Please select an end date");
        }

        if (startDate && endDate) {
          if (isDateInPast(startDate)) {
            errors.push("Start date cannot be in the past");
          }

          const start = new Date(startDate);
          const end = new Date(endDate);

          if (start > end) {
            errors.push("End date must be after start date");
          }

          if (rentalDays < MIN_RENTAL_DAYS) {
            errors.push(`Minimum rental period is ${MIN_RENTAL_DAYS} day(s)`);
          }

          if (rentalDays > MAX_RENTAL_DAYS) {
            errors.push(`Maximum rental period is ${MAX_RENTAL_DAYS} days`);
          }
        }

        return errors;
      },

      getStartDate: () => {
        const { startDate } = get();
        if (!startDate) return null;
        const date = new Date(startDate);
        return isValidDate(date) ? date : null;
      },

      getEndDate: () => {
        const { endDate } = get();
        if (!endDate) return null;
        const date = new Date(endDate);
        return isValidDate(date) ? date : null;
      },

      hasVehicleSelected: () => {
        const { selectedVehicleId, name, startDate, endDate } = get();
        return !!(selectedVehicleId && name && startDate && endDate);
      },
    }),
    {
      name: "vehicle-rental-dates",
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);

// Selector hooks for convenience
export const useVehicleRentalDates = () => {
  const startDate = useVehicleRentalStore((state) => state.startDate);
  const endDate = useVehicleRentalStore((state) => state.endDate);

  return {
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
  };
};
