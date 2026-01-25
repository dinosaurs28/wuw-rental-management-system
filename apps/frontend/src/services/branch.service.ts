import axios from 'axios';
import { z } from "zod";
import { emailAuthSchemaSignin } from "@repo/schemas";
import apiClient from "@/lib/axios";

const API_URL = import.meta.env.VITE_API_URL

export interface BranchResponse {
    message: string;
    data: {
        publicId: string;
        name: string;
    }[];
}

export type SignInInput = z.infer<typeof emailAuthSchemaSignin>;

export interface BranchManagerAuthResponse {
    message: string;
    user: {
        id: string;
        name: string;
        email: string;
        role: string;
    };
}

export const fetchBranches = async (): Promise<BranchResponse['data']> => {
    try {
        const response = await axios.get<BranchResponse>(`${API_URL}/public/branches`);
        return response.data.data;
    } catch (error) {
        console.error('Error fetching branches:', error);
        throw error;
    }
};

export const branchManagerService = {
    login: async (data: SignInInput): Promise<BranchManagerAuthResponse> => {
        const response = await apiClient.post<BranchManagerAuthResponse>("/branchManager/auth/login", data);
        return response.data;
    }
};
