import axios from "axios";
import { z } from "zod";
import { emailAuthSchemaSignin } from "@repo/schemas";
import apiClient from "@/lib/axios";

const API_URL = import.meta.env.VITE_API_URL;

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

export const fetchBranches = async (): Promise<BranchResponse["data"]> => {
  try {
    const response = await axios.get<BranchResponse>(
      `${API_URL}/public/branches`,
    );
    return response.data.data;
  } catch (error) {
    console.error("Error fetching branches:", error);
    throw error;
  }
};

// ── Branch schedule ───────────────────────────────────────────────────────────

export interface BranchScheduleRow {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  isOpen: boolean;
  openTime: string;  // "HH:mm" 24-hr
  closeTime: string; // "HH:mm" 24-hr
}

export interface BranchScheduleConfig {
  schedules: BranchScheduleRow[];
  graceMinutes: number;
  is24Hours: boolean;
}

export async function fetchBranchSchedule(branchPublicId: string): Promise<BranchScheduleConfig> {
  const { data } = await apiClient.get<BranchScheduleConfig>(
    `/public/branch/${branchPublicId}/schedule`,
  );
  return data;
}

export const branchManagerService = {
  login: async (data: SignInInput): Promise<BranchManagerAuthResponse> => {
    const response = await apiClient.post<BranchManagerAuthResponse>(
      "/branchManager/auth/login",
      data,
    );
    return response.data;
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      "/branchManager/auth/forgot-password",
      { email },
    );
    return response.data;
  },

  resetPassword: async (
    token: string,
    password: string,
  ): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(
      "/branchManager/auth/reset-password",
      { token, password },
    );
    return response.data;
  },
};
