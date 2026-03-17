import apiClient from "@/lib/axios";

export interface BranchEmployee {
  publicId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
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
  phone: string;
}

export interface CreateEmployeeResponse {
  message: string;
  data: BranchEmployee;
  tempPassword: string;
}

export interface UpdateEmployeeInput {
  name?: string;
  phone?: string;
  // role?: string; // Role update might be separate or here, keeping simple for now
}

export const branchEmployeeService = {
  getAll: async (params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<GetEmployeesResponse> => {
    const response = await apiClient.get<GetEmployeesResponse>(
      "/branchManager/dashboard/employees",
      {
        params,
      },
    );
    return response.data;
  },

  create: async (
    data: CreateEmployeeInput,
  ): Promise<CreateEmployeeResponse> => {
    const response = await apiClient.post<CreateEmployeeResponse>(
      "/branchManager/dashboard/employees",
      data,
    );
    return response.data;
  },

  update: async (id: string, data: UpdateEmployeeInput): Promise<void> => {
    await apiClient.put(`/branchManager/dashboard/employees/${id}`, data);
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/branchManager/dashboard/employees/${id}`);
  },
};
