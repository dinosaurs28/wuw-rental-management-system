import apiClient from "@/lib/axios";

// Types based on backend response
export interface BookingVehicle {
    publicId: string;
    make: string;
    model: string;
    thumbnail: string | null;
    finalTotal: number;
}

export interface Booking {
    bookingId: string;
    status: 'CONFIRMED' | 'RETURNED' | 'CANCELLED';
    paymentStatus: string;
    startAt: string;
    endAt: string;
    days: number;
    total: number;
    createdAt: string;
    vehicles: BookingVehicle[];
}

export interface BookingMeta {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
}

export interface GetUserBookingsResponse {
    message: string;
    meta: BookingMeta;
    data: Booking[];
}

export const userBookingsService = {
    /**
     * Get user booking history
     * GET /user/booking/history
     * @param type - 'active' | 'past' - filter for booking status
     * @param page - page number (1-indexed)
     * @param limit - items per page
     */
    getUserBookings: async (
        type: 'active' | 'past' = 'active',
        page: number = 1,
        limit: number = 10
    ): Promise<GetUserBookingsResponse> => {
        const response = await apiClient.get<GetUserBookingsResponse>(
            `/user/booking/history`,
            {
                params: { type, page, limit }
            }
        );
        return response.data;
    },
};
