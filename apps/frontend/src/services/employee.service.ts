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

export const employeeService = {
    login: async (data: SignInInput): Promise<EmployeeAuthResponse> => {
        const response = await apiClient.post<EmployeeAuthResponse>("/employee/auth/login", data);
        return response.data;
    }
};
