import apiClient from "@/lib/axios";

export interface BranchEmployee {
    publicId: string;
    name: string;
    email: string;
    phone: string;
    role: string;
    isActive: boolean;
    createdAt: string;
}

export interface GetEmployeesResponse {
    data: BranchEmployee[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface CreateEmployeeInput {
    name: string;
    email: string;
    phone: string;
    password: string;
}

export interface UpdateEmployeeInput {
    name?: string;
    email?: string;
    phone?: string;
    // role?: string; // Role update might be separate or here, keeping simple for now
}

export const branchEmployeeService = {
    getAll: async (params?: {
        page?: number;
        limit?: number;
        search?: string;
    }): Promise<GetEmployeesResponse> => {
        const response = await apiClient.get<GetEmployeesResponse>("/branchManager/dashboard/employees", {
            params,
        });
        return response.data;
    },

    create: async (data: CreateEmployeeInput): Promise<void> => {
        await apiClient.post("/branchManager/dashboard/employees", data);
    },

    update: async (id: string, data: UpdateEmployeeInput): Promise<void> => {
        await apiClient.put(`/branchManager/dashboard/employees/${id}`, data);
    },

    setStatus: async (id: string, isActive: boolean): Promise<void> => {
        await apiClient.patch(`/branchManager/dashboard/employees/${id}/status`, { isActive });
    },
};
