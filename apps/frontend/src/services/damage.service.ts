import axios from "../lib/axios";

export interface DamageReport {
  damageReportId: string;
  status: string;
  booking: {
    bookingId: string;
    deposit: number;
  };
  vehicle: {
    regNo: string;
    make: string;
    model: string;
    currentStatus: string;
  };
  damageDetails: Record<string, any>; // Dynamic JSON
  images: { url: string }[];
  financialHint: {
    deposit: number;
    estimatedCost: number;
  };
}

export interface CloseDamagePayload {
  disposition: "AVAILABLE" | "MAINTENANCE" | "DAMAGED";
  finalCost: number;
  paymentMethod?: "CASH" | "ONLINE_RAZORPAY";
  redirectUrl?: string; // Add redirectUrl for custom redirection after payment
}

export interface CloseDamageResponse {
  message: string;
  refunded: boolean;
  settled: boolean;
  paymentUrl?: string;
}

export const getDamageReport = async (
  damageReportId: string,
): Promise<DamageReport> => {
  const response = await axios.get<DamageReport>(
    `/branchManager/damage-reports/${damageReportId}`,
  );
  return response.data;
};

export const closeDamageReport = async (
  damageReportId: string,
  data: CloseDamagePayload,
): Promise<CloseDamageResponse> => {
  const response = await axios.patch<CloseDamageResponse>(
    `/branchManager/damage-reports/${damageReportId}/close`,
    data,
  );
  return response.data;
};
