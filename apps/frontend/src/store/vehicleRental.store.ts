import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

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
    dateSelectionTimestamp: number | null;

    // Pricing
    rentalDays: number;
    pricePerDay: number;
    totalPrice: number;
    deposit: number;

    // Booking state
    selectedKycFilePublicId: string | null;
    paymentType: 'CASH' | 'ONLINE' | null;

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
    setVehicleDetails: (details: { name: string; model: string; make: string }) => void;
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
    setDateRange: (startDate: Date | null, endDate: Date | null) => void;
    setPricePerDay: (price: number) => void;
    setDeposit: (deposit: number) => void;
    setSelectedKyc: (filePublicId: string | null) => void;
    setPaymentType: (type: 'CASH' | 'ONLINE' | null) => void;
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

// Helper to calculate days between two dates
// Returns minimum 1 day for same-day rentals
const calculateDaysBetween = (start: string | null, end: string | null): number => {
    if (!start || !end) return 0;

    const startDate = new Date(start);
    const endDate = new Date(end);

    // Validate dates
    if (!isValidDate(startDate) || !isValidDate(endDate)) return 0;

    const startTime = startDate.setHours(0, 0, 0, 0);
    const endTime = endDate.setHours(0, 0, 0, 0);
    const diffTime = endTime - startTime;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Minimum 1 day rental (same day = 1 day)
    return diffDays >= 0 ? Math.max(diffDays, MIN_RENTAL_DAYS) : 0;
};

// Helper to convert Date to ISO string
const toISOString = (date: Date | null): string | null => {
    if (!date || !isValidDate(date)) return null;
    return date.toISOString();
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
            dateSelectionTimestamp: null,
            rentalDays: 0,
            pricePerDay: 0,
            totalPrice: 0,
            deposit: 0,
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
                const startDateStr = toISOString(date);

                if (!startDateStr) {
                    set({ startDate: null });
                    return;
                }

                const rentalDays = calculateDaysBetween(startDateStr, state.endDate);
                set({
                    startDate: startDateStr,
                    dateSelectionTimestamp: Date.now(),
                    rentalDays,
                    totalPrice: rentalDays * state.pricePerDay,
                });
            },

            setEndDate: (date) => {
                const state = get();
                const endDateStr = toISOString(date);

                if (!endDateStr) {
                    set({ endDate: null });
                    return;
                }

                const rentalDays = calculateDaysBetween(state.startDate, endDateStr);
                set({
                    endDate: endDateStr,
                    dateSelectionTimestamp: Date.now(),
                    rentalDays,
                    totalPrice: rentalDays * state.pricePerDay,
                });
            },

            setDateRange: (startDate, endDate) => {
                const state = get();
                const startDateStr = toISOString(startDate);
                const endDateStr = toISOString(endDate);
                const rentalDays = calculateDaysBetween(startDateStr, endDateStr);
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

            setSelectedKyc: (filePublicId) => set({ selectedKycFilePublicId: filePublicId }),

            setPaymentType: (type) => set({ paymentType: type }),

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
                const { startDate, endDate } = get();
                return calculateDaysBetween(startDate, endDate);
            },

            calculateTotalPrice: () => {
                const { rentalDays, pricePerDay } = get();
                return rentalDays * pricePerDay;
            },

            clearDates: () =>
                set({
                    startDate: null,
                    endDate: null,
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
                    dateSelectionTimestamp: null,
                    rentalDays: 0,
                    pricePerDay: 0,
                    totalPrice: 0,
                    deposit: 0,
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
                    errors.push('Please select a start date');
                }
                if (!endDate) {
                    errors.push('Please select an end date');
                }

                if (startDate && endDate) {
                    if (isDateInPast(startDate)) {
                        errors.push('Start date cannot be in the past');
                    }

                    const start = new Date(startDate);
                    const end = new Date(endDate);

                    if (start > end) {
                        errors.push('End date must be after start date');
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
            name: 'vehicle-rental-dates',
            storage: createJSONStorage(() => sessionStorage),
        }
    )
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