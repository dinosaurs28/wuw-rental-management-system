import apiClient from "@/lib/axios";
import type { UpdateProfileInput } from "@repo/schemas";

export interface UserProfile {
  name: string;
  /** null when the account only has a placeholder email. */
  email: string | null;
  phone: string;
  /** Kept for older customers; no longer asked for (Oct 2026). */
  dob: string | null;
  /** Entered age, else derived from dob on the server; absent from older servers. */
  age?: number | null;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  alternatePhone: string;
  /** Full, normalised (owner only). */
  drivingLicenceNumber: string | null;
  /** Full 12 digits (owner only) — never log it. */
  aadhaarNumber: string | null;
  /** Derived on the server: every required field (age, or dob / both numbers for older profiles). */
  isProfileCompleted: boolean;
  /** Empty required fields (keys of CUSTOMER_PROFILE_FIELD_LABELS). */
  missingFields?: string[];
}

export interface UpdateProfileResponse {
  message: string;
  isProfileCompleted: boolean;
  missingFields?: string[];
  data: Omit<UserProfile, "isProfileCompleted" | "missingFields">;
}

export const userService = {
  getProfile: async (): Promise<UserProfile> => {
    const response = await apiClient.get<UserProfile>("/user/profile");
    return response.data;
  },

  updateProfile: async (
    data: UpdateProfileInput,
  ): Promise<UpdateProfileResponse> => {
    const response = await apiClient.put<UpdateProfileResponse>(
      "/user/profile",
      data,
    );
    return response.data;
  },
};
