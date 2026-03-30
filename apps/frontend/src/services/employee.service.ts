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
};

