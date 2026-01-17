import { create } from 'zustand';
import { userBookingsService } from '../services/userBookings.service';
import type { Booking, BookingMeta } from '../services/userBookings.service';
import { toast } from 'sonner';

interface BookingsState {
    bookings: Booking[];
    isLoading: boolean;
    error: string | null;
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
    filter: 'active',
    meta: null,

    fetchBookings: async (filter?: 'active' | 'past', page: number = 1) => {
        const currentFilter = filter ?? get().filter;
        set({ isLoading: true, error: null });

        try {
            const response = await userBookingsService.getUserBookings(currentFilter, page);
            set({
                bookings: response.data,
                meta: response.meta,
                isLoading: false,
                filter: currentFilter,
            });
        } catch (error: unknown) {
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
            filter: 'active',
            meta: null,
        });
    },
}));
