import apiClient from "@/lib/axios";

/** GET /employee/customer/:publicId — staff customer detail. */
export interface EmployeeCustomerDetail {
  name: string;
  /** null for a walk-in without a real email (placeholder hidden). */
  email: string | null;
  phone: string;
  dob?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  isProfileCompleted?: boolean;
  /** Full number — prefills the complete-profile form. */
  drivingLicenceNumber?: string | null;
  /** Full 12 digits — prefill only; show masked anywhere read-only. */
  aadhaarNumber?: string | null;
  missingFields: string[];
  /** Blacklisted by a branch manager — new bookings are refused. */
  isBlacklisted?: boolean;
  blacklistReason?: string | null;
  blacklistedAt?: string | null;
}

/** POST /employee/walkin/complete body. */
export interface CompleteWalkinProfilePayload {
  customer_public_id: string;
  name: string;
  /** Omit when blank — the stored email (real or placeholder) is kept. */
  email?: string;
  drivingLicenceNumber: string;
  aadhaarNumber: string;
  dob?: string;
  addressLine1: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface CompleteWalkinProfileResponse {
  message: string;
  customer_public_id: string;
  isProfileCompleted: boolean;
  missingFields: string[];
  /** false = the customer has no real email (placeholder kept). */
  hasEmail: boolean;
}

/** POST /employee/walkin/initiate response. */
export interface InitiateWalkinResponse {
  message: string;
  otp: number | string;
  customer_public_id: string;
  /** true = an abandoned, never-verified walk-in for this phone was resumed. */
  resumed?: boolean;
}

/** react-query key of GET /employee/customer/:publicId. */
export const employeeCustomerKey = (publicId: string) =>
  ["employee-customer", publicId] as const;

export const employeeCustomerService = {
  getCustomer: async (publicId: string): Promise<EmployeeCustomerDetail> => {
    const response = await apiClient.get<{
      message: string;
      data: EmployeeCustomerDetail;
    }>(`/employee/customer/${encodeURIComponent(publicId)}`);
    return response.data.data;
  },

  initiateWalkin: async (phone: string): Promise<InitiateWalkinResponse> => {
    const response = await apiClient.post<InitiateWalkinResponse>(
      "/employee/walkin/initiate",
      { phone },
    );
    return response.data;
  },

  completeWalkinProfile: async (
    payload: CompleteWalkinProfilePayload,
  ): Promise<CompleteWalkinProfileResponse> => {
    const response = await apiClient.post<CompleteWalkinProfileResponse>(
      "/employee/walkin/complete",
      payload,
    );
    return response.data;
  },
};
