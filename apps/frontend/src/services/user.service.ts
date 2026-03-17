import apiClient from "@/lib/axios";
import type { UpdateProfileInput } from "@repo/schemas";

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  dob: string | null;
  addressLine1: string;
  city: string;
  state: string;
  country: string;
  zipCode: string;
  alternatePhone: string;
  isProfileCompleted: boolean;
}

export interface UpdateProfileResponse {
  message: string;
  isProfileCompleted: boolean;
  data: Omit<UserProfile, "isProfileCompleted">;
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
