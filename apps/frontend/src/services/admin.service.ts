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

export const adminService = {
    login: async (data: SignInInput): Promise<AdminAuthResponse> => {
        const response = await apiClient.post<AdminAuthResponse>("/admin/auth/login", data);
        return response.data;
    }
};
