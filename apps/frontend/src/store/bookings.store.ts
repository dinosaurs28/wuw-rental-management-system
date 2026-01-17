import { create } from 'zustand';
import { userBookingsService } from '../services/userBookings.service';
import type { Booking, BookingMeta } from '../services/userBookings.service';
import { toast } from 'sonner';
import axios from 'axios';

interface BookingsState {
    bookings: Booking[];
    isLoading: boolean;
    error: string | null;
    profileNotFound: boolean; // Flag for when customer profile doesn't exist
    filter: 'active' | 'past';
    meta: BookingMeta | null;

    // Actions
    fetchBookings: (filter?: 'active' | 'past', page?: number) => Promise<void>;
    setFilter: (filter: 'active' | 'past') => void;
    reset: () => void;
}

export const useBookingsStore = create<BookingsState>((set, get) => ({
    bookings: [],
    isLoading: false,
    error: null,
    profileNotFound: false,
    filter: 'active',
    meta: null,

    fetchBookings: async (filter?: 'active' | 'past', page: number = 1) => {
        const currentFilter = filter ?? get().filter;
        set({ isLoading: true, error: null, profileNotFound: false });

        try {
            const response = await userBookingsService.getUserBookings(currentFilter, page);
            set({
                bookings: response.data,
                meta: response.meta,
                isLoading: false,
                filter: currentFilter,
            });
        } catch (error: unknown) {
            // Handle "Customer profile not found" error specifically
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const message = error.response?.data?.message;

                if (status === 400 && message === "Customer profile not found") {
                    set({
                        profileNotFound: true,
                        isLoading: false,
                        bookings: [],
                        error: null
                    });
                    return; // Don't show error toast for this case
                }
            }

            const errorMessage = error instanceof Error ? error.message : 'Failed to fetch bookings';
            set({ error: errorMessage, isLoading: false, bookings: [] });
            toast.error(errorMessage);
        }
    },

    setFilter: (filter: 'active' | 'past') => {
        set({ filter });
        get().fetchBookings(filter);
    },

    reset: () => {
        set({
            bookings: [],
            isLoading: false,
            error: null,
            profileNotFound: false,
            filter: 'active',
            meta: null,
        });
    },
}));
