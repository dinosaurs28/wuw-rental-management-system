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
    contactNumber?: string;
    managerEmail?: string; // Optional invite
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
    }
};
