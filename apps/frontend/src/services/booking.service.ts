import apiClient from "@/lib/axios";

// Existing Customer Interfaces...
// Types for booking summary request
export interface CreateBookingSummaryRequest {
    vehicles: string[];          // Vehicle public IDs
    start: string;               // ISO date string
    end: string;                 // ISO date string
    file_public_id: string;      // KYC document file public ID
    payment_type: 'CASH' | 'ONLINE';
}

// Types for booking summary response
export interface BookingItem {
    publicId: string;
    make: string;
    model: string;
    category: string;
    branch: string;
    days: number;
    baseTotal: number;
    discountAmount: number;
    discountPercent: number;
    deposit: number;
    finalTotal: number;
}

export interface BookingTotals {
    grandBaseTotal: number;
    grandDiscountTotal: number;
    grandDeposit: number;
    grandFinalTotal: number;
    paymentURL: string | null;
    encryptedFinalPrice: string | null;
    transactionId: string | null;
}

export interface CreateBookingSummaryResponse {
    message: string;
    holdId: string;
    payment_type: 'CASH' | 'ONLINE';
    expiresIn: number;
    expiresAt: string;
    data: {
        items: BookingItem[];
        startDate: string;
        endDate: string;
        totals: BookingTotals;
    };
}

// Online payment status response
export interface PaymentStatusResponse {
    status: 'Success' | 'Pending' | 'Failed';
    message?: string;
    redirectURL?: string;
}

// Cash payment confirmation request/response
export interface ConfirmCashPaymentRequest {
    encryptedFinalPrice: string;
    transactionId: string;
    payment_type?: string;
}

export interface ConfirmCashPaymentResponse {
    status: 'Success' | 'Failed';
    message: string;
    redirectURL?: string;
}

// --- EMPLOYEE INTERFACES & SERVICE ---

export interface EmployeeBooking {
    publicId: string;
    startAt: string;
    endAt: string;
    status: string;
    totalFinal: string;
    customer: {
        user: {
            publicId: string;
            name: string;
            phone?: string;
            email?: string;
        };
    };
    items: {
        vehicle: {
            publicId: string;
            make: string;
            model: string;
            regNo: string;
            status: string;
            category: string;
            odo: number;
            fuelLevel: number;
            images: {
                file: {
                    url: string;
                }
            }[];
        };
    }[];
}

export const bookingService = {
    // --- CUSTOMER METHODS ---
    /**
     * Create a booking summary and initiate payment
     * POST /public/vehicles/booking
     * Returns payment details (paymentURL for online, encryptedFinalPrice for cash)
     */
    createBookingSummary: async (
        data: CreateBookingSummaryRequest
    ): Promise<CreateBookingSummaryResponse> => {
        const response = await apiClient.post<CreateBookingSummaryResponse>(
            "/public/vehicles/booking",
            data
        );
        return response.data;
    },

    /**
     * Verify online payment status
     * GET /payment/status/:transactionId
     */
    verifyOnlinePayment: async (
        transactionId: string
    ): Promise<PaymentStatusResponse> => {
        const response = await apiClient.get<PaymentStatusResponse>(
            `/payment/status/${transactionId}`
        );
        return response.data;
    },

    /**
     * Confirm cash payment
     * POST /user/payment/cash
     */
    confirmCashPayment: async (
        data: ConfirmCashPaymentRequest
    ): Promise<ConfirmCashPaymentResponse> => {
        const response = await apiClient.post<ConfirmCashPaymentResponse>(
            "/user/payment/cash",
            data
        );
        return response.data;
    },

    // --- EMPLOYEE METHODS ---

    /**
     * Get details for pickup process
     * GET /employee/pickup/:bookingId
     */
    getPickupDetails: async (bookingId: string) => {
        const response = await apiClient.get<{ data: EmployeeBooking }>(`/employee/pickup/${bookingId}`);
        return response.data.data;
    },

    // Fetch Pickups
    getEmployeeBookings: async (date?: Date) => {
        try {
            const query = date ? `?date=${date.toISOString()}` : "";
            const response = await apiClient.get<{ data: EmployeeBooking[] }>(`/employee/booking${query}`);
            return response.data.data;
        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                return [];
            }
            throw error;
        }
    },

    // Fetch Returns
    getEmployeeReturns: async (date?: Date) => {
        try {
            const query = date ? `?date=${date.toISOString()}` : "";
            const response = await apiClient.get<{ data: EmployeeBooking[] }>(`/employee/return${query}`);
            return response.data.data;
        } catch (error: any) {
            if (error.response && error.response.status === 404) {
                return [];
            }
            throw error;
        }
    },

    // Approve Pickup
    approvePickup: async (bookingId: string, data: { odo: number; fuelLevel: number }) => {
        const response = await apiClient.post(`/employee/pickup/${bookingId}`, data);
        return response.data;
    },

    // Get Return Details
    getReturnDetails: async (bookingId: string) => {
        const response = await apiClient.get<{ data: EmployeeBooking }>(`/employee/return/${bookingId}`);
        return response.data.data;
    },

    // Upload Return Image
    uploadReturnImage: async (formData: FormData) => {
        const response = await apiClient.post<{ fileId: string; url: string }>("/employee/return/upload", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        });
        return response.data;
    },

    // Delete Return Image
    deleteReturnImage: async (publicId: string) => {
        const response = await apiClient.delete(`/employee/return/image/${publicId}`);
        return response.data;
    },

    // Complete Return (No Damage)
    completeReturn: async (bookingId: string, data: { returnImageIds: string[] }) => {
        const response = await apiClient.post(`/employee/return/${bookingId}/complete`, data);
        return response.data;
    },

    // Upload Damage Image
    uploadDamageImage: async (formData: FormData) => {
        const response = await apiClient.post<{ fileId: string; url: string }>("/employee/damage/upload", formData, {
            headers: { "Content-Type": "multipart/form-data" },
        });
        return response.data;
    },

    // Report Damage
    reportDamage: async (data: {
        bookingId: string;
        odo: number;
        fuelLevel: number;
        severity: string;
        damageImageIds: string[];
        notes: any;
        returnImageIds: string[];
    }) => {
        const response = await apiClient.post("/employee/damage/report", data);
        return response.data;
    },
};
