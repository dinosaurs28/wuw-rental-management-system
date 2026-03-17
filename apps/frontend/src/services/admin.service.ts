import { z } from "zod";
import { emailAuthSchemaSignin } from "@repo/schemas";
import apiClient from "@/lib/axios";

export type SignInInput = z.infer<typeof emailAuthSchemaSignin>;

export interface AdminAuthResponse {
    message: string;
    user: {
        id: string;
        name: string;
        email: string;
        role: string;
    };
}

export type AdminBranch = {
    id: string; // Internal ID
    publicId: string; // Public ID
    name: string;
    address: string;
    status: string;
    phone?: string;
    _count?: {
        users: number;
        vehicles: number;
        bookings: number;
    };
    users?: {
        name: string;
        email: string;
    }[];
};

export type CreateBranchInput = {
    name: string;
    address: string;
    phone?: string;
    managerName: string;
    managerEmail: string;
    managerPassword: string;
};

export type UpdateBranchInput = Partial<CreateBranchInput> & {
    status?: string;
};

export type RevenueReportParams = {
    startDate?: string; // ISO date string
    endDate?: string;   // ISO date string
    branchId?: string;
    reportType: 'revenue_only';
};

export type RevenueReportItem = {
    branchId: string;
    branchName: string;
    totalRevenue: number;
    totalExpenses?: number;
    netProfit: number;
    currency: string;
};

export type RevenueReportResponse = {
    message: string;
    dateRange: { start: string; end: string };
    data: RevenueReportItem[];
};

export type RevenueTrendItem = {
    period: string;
    totalRevenue: number;
    bookingCount: number;
    avgRevenuePerBooking: number;
    branchId?: string;
    branchName?: string;
};

export type RevenueTrendParams = {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    granularity?: 'daily' | 'weekly' | 'monthly';
};

export type CategoryRevenueItem = {
    categoryId: string;
    categoryName: string;
    totalRevenue: number;
    bookingCount: number;
    vehicleCount: number;
    avgRevenuePerVehicle: number;
};

export type KPISummaryData = {
    totalRevenue: number;
    revenueChange: number;
    totalBookings: number;
    bookingChange: number;
    avgBookingValue: number;
    avgBookingValueChange: number;
};

export type PaymentMethodItem = {
    paymentMethod: string;
    totalRevenue: number;
    transactionCount: number;
    avgTransactionValue: number;
    percentageShare: number;
};

export type VehicleHistoryBooking = {
    bookingId: string;
    customerName: string;
    customerPhone: string;
    startDate: string;
    endDate: string;
    days: number;
    revenue: number;
    depositAmount: number;
    status: string;
    damageReported: boolean;
    returnCondition: string;
};

export type VehicleHistoryMaintenance = {
    id: number;
    date: string;
    description: string;
    cost: number;
};

export type VehicleHistoryDamage = {
    id: number;
    bookingId: string;
    customerName: string;
    reportedDate: string;
    notes: any; // JSON field
    severity: string;
    estimatedCost: number;
    finalCost: number;
    status: string;
};

export type VehicleHistoryData = {
    vehicle: {
        id: string;
        regNo: string;
        make: string;
        model: string;
        category: string;
        branch: string;
        status: string;
        currentOdometer: number;
        insuranceExpiry: string | null;
    };
    performanceMetrics: {
        totalRevenue: number;
        totalBookings: number;
        avgRevenuePerBooking: number;
        utilizationRate: number;
        totalMaintenanceCost: number;
        totalDamageCost: number;
        netProfitability: number;
        roi: number;
        vehicleAge: number;
    };
    currentStatus: {
        isActive: boolean;
        currentBooking: {
            bookingId: string;
            customerName: string;
            customerPhone: string;
            startDate: string;
            expectedReturn: string;
        } | null;
    };
    bookingHistory: {
        data: VehicleHistoryBooking[];
        totalCount: number;
        pagination: {
            currentPage: number;
            totalPages: number;
        };
    };
    maintenanceHistory: VehicleHistoryMaintenance[];
    damageHistory: VehicleHistoryDamage[];
    upcomingAlerts: {
        insuranceExpiry: {
            date: string;
            daysRemaining: number;
        } | null;
        permitExpiry: null;
        nextServiceDue: null;
    };
};

export type VehicleHistoryResponse = {
    message: string;
    data: VehicleHistoryData;
};

export const adminService = {
    login: async (data: SignInInput): Promise<AdminAuthResponse> => {
        const response = await apiClient.post<AdminAuthResponse>("/admin/auth/login", data);
        return response.data;
    },

    getBranches: async (): Promise<AdminBranch[]> => {
        const response = await apiClient.get<{ data: AdminBranch[] }>("/admin/dashboard/branches");
        return response.data.data; // Assuming backend returns { data: [...] } standard wrapper, or direct array. Let's check backend controller.
    },

    createBranch: async (data: CreateBranchInput): Promise<AdminBranch> => {
        const response = await apiClient.post<{ message: string; data: AdminBranch }>("/admin/dashboard/branches/create", data);
        return response.data.data;
    },

    updateBranch: async (branchId: string, data: UpdateBranchInput): Promise<AdminBranch> => {
        const response = await apiClient.put<{ message: string; data: AdminBranch }>(`/admin/dashboard/branches/edit/${branchId}`, data);
        return response.data.data;
    },

    getBranchDetails: async (branchId: string): Promise<AdminBranch & { managerName: string; managerEmail: string }> => {
        const response = await apiClient.get<{ message: string; data: AdminBranch & { managerName: string; managerEmail: string } }>(`/admin/dashboard/branches/${branchId}`);
        return response.data.data;
    },

    deleteBranch: async (branchId: string): Promise<void> => {
        await apiClient.delete(`/admin/dashboard/branches/delete/${branchId}`);
    },

    getRevenueReport: async (params: RevenueReportParams): Promise<RevenueReportResponse> => {
        const response = await apiClient.get<RevenueReportResponse>("/admin/dashboard/reports/revenue", { params });
        return response.data;
    },

    getRevenueTrends: async (params: RevenueTrendParams): Promise<{ message: string; data: RevenueTrendItem[] }> => {
        const response = await apiClient.get("/admin/dashboard/reports/revenue-trends", { params });
        return response.data;
    },

    getRevenueByCategory: async (params: { startDate?: string; endDate?: string; branchId?: string }): Promise<{ message: string; data: CategoryRevenueItem[] }> => {
        const response = await apiClient.get("/admin/dashboard/reports/revenue-by-category", { params });
        return response.data;
    },

    getKPISummary: async (params: { startDate?: string; endDate?: string; branchId?: string }): Promise<{ message: string; data: KPISummaryData }> => {
        const response = await apiClient.get("/admin/dashboard/reports/kpi-summary", { params });
        return response.data;
    },

    getPaymentMethodBreakdown: async (params: { startDate?: string; endDate?: string; branchId?: string }): Promise<{ message: string; data: PaymentMethodItem[] }> => {
        const response = await apiClient.get("/admin/dashboard/reports/payment-methods", { params });
        return response.data;
    },

    getCategories: async (): Promise<{ publicId: string; name: string }[]> => {
        const response = await apiClient.get<{ data: { publicId: string; name: string }[] }>("/admin/dashboard/categories");
        return response.data.data;
    },

    getVehicleHistory: async (vehicleId: string, exportFormat?: 'xlsx' | 'csv'): Promise<VehicleHistoryResponse | Blob> => {
        const params = exportFormat ? { export: exportFormat } : {};
        const config = exportFormat ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get<VehicleHistoryResponse | Blob>(
            `/admin/dashboard/reports/vehicle-history/${vehicleId}`,
            config
        );

        return response.data;
    },

    // Daily Summary Report
    getDailySummaryReport: async (params: { date: string; branchId?: string; export?: 'xlsx' | 'csv' }): Promise<any> => {
        const config = params.export ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get('/admin/dashboard/reports/daily-summary', config);
        return response.data;
    },

    // Sales Report
    getSalesReport: async (params: {
        startDate: string;
        endDate: string;
        branchId?: string;
        status?: string;
        export?: 'xlsx' | 'csv';
    }): Promise<any> => {
        const config = params.export ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get('/admin/dashboard/reports/sales', config);
        return response.data;
    },

    // Vehicle Availability Report
    getVehicleAvailabilityReport: async (params: {
        startDate: string;
        endDate: string;
        branchId?: string;
        export?: 'xlsx' | 'csv';
    }): Promise<any> => {
        const config = params.export ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get('/admin/dashboard/reports/vehicle-availability', config);
        return response.data;
    },

    // Insurance & Permit Expiry Report
    getInsurancePermitExpiryReport: async (params: {
        alertType?: 'insurance' | 'permit' | 'all';
        daysThreshold?: number;
        branchId?: string;
        export?: 'xlsx' | 'csv';
    }): Promise<any> => {
        const config = params.export ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get('/admin/dashboard/reports/insurance-permit-expiry', config);
        return response.data;
    },

    // Collection Report
    getCollectionReport: async (params: {
        startDate: string;
        endDate: string;
        branchId?: string;
        paymentMethod?: string;
        export?: 'xlsx' | 'csv';
    }): Promise<any> => {
        const config = params.export ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get('/admin/dashboard/reports/collection', config);
        return response.data;
    },

    // Fleet Executive Report
    getFleetExecutiveReport: async (params: {
        startDate: string;
        endDate: string;
        export?: 'xlsx' | 'csv';
    }): Promise<any> => {
        const config = params.export ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get('/admin/dashboard/reports/fleet-executive', config);
        return response.data;
    },

    // GST Report
    getGSTReport: async (params: {
        startDate: string;
        endDate: string;
        branchId?: string;
        export?: 'xlsx' | 'csv';
    }): Promise<any> => {
        const config = params.export ? {
            params,
            responseType: 'blob' as const
        } : { params };

        const response = await apiClient.get('/admin/dashboard/reports/gst', config);
        return response.data;
    },

    // Get All Vehicles (for vehicle reports list)
    getAllVehicles: async (): Promise<any> => {
        const response = await apiClient.get('/admin/dashboard/vehicles');
        return response.data;
    }
};
