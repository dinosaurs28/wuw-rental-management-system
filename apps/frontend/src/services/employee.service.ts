import apiClient from "@/lib/axios";
import { z } from "zod";
import { emailAuthSchemaSignin } from "@repo/schemas";

export type SignInInput = z.infer<typeof emailAuthSchemaSignin>;

export interface EmployeeAuthResponse {
  message: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
}

export interface EmployeeDashboardStats {
  todaysPickups: number;
  todaysReturns: number;
  activeRentals: number;
}

export const employeeService = {
  login: async (data: SignInInput): Promise<EmployeeAuthResponse> => {
    const response = await apiClient.post<EmployeeAuthResponse>(
      "/employee/auth/login",
      data,
    );
    return response.data;
  },

  searchVehicles: async (filters: any) => {
    const params = new URLSearchParams();
    // Map filters to query params
    if (filters.category) params.append("category", filters.category);
    if (filters.search) params.append("search", filters.search);
    if (filters.sort) params.append("sort", filters.sort);
    if (filters.start) params.append("start", filters.start);
    if (filters.end) params.append("end", filters.end);
    if (filters.limit) params.append("limit", filters.limit);
    if (filters.offset) params.append("offset", filters.offset);
    // Note: Branch is handled by backend token

    const response = await apiClient.get("/employee/vehicles/search", {
      params,
    });
    return response.data;
  },

  getVehicleCategories: async (): Promise<{ publicId: string; name: string }[]> => {
    const response = await apiClient.get<{
      data: { publicId: string; name: string }[];
    }>("/employee/vehicles/categories");
    return response.data.data;
  },

  getDashboardStats: async (): Promise<EmployeeDashboardStats> => {
    const response = await apiClient.get<EmployeeDashboardStats>(
      "/employee/dashboard/stats",
    );
    return response.data;
  },

  getVehicleGroupDetails: async (
    groupKey: string,
    startDate?: string,
    endDate?: string,
  ) => {
    const response = await apiClient.get(
      `/employee/vehicles/group/${encodeURIComponent(groupKey)}`,
      { params: { start: startDate, end: endDate } },
    );
    return response.data;
  },

  getCustomerBookingLimits: async (
    customerPublicId: string,
    start: string,
    end: string,
  ) => {
    const response = await apiClient.get(
      `/employee/customer/${customerPublicId}/booking-limits`,
      { params: { start, end } },
    );
    return response.data as {
      usedTypeClasses: Partial<
        Record<
          "TWO_WHEELER" | "FOUR_WHEELER",
          {
            bookingPublicId: string;
            vehicleMake: string;
            vehicleModel: string;
            startAt: string;
            endAt: string;
            status: "HOLD" | "CONFIRMED" | "PICKED_UP";
            holdExpiresAt: string | null;
          }
        >
      >;
    };
  },

  scanBooking: async (bookingId: string): Promise<{
    publicId: string;
    status: string;
    customerName: string;
    vehicleName: string | null;
    regNo: string | null;
  }> => {
    const response = await apiClient.get(`/employee/booking/${bookingId}/scan`);
    return response.data.data;
  },
};

