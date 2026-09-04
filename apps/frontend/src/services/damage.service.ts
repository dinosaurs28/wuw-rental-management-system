import axios from "../lib/axios";
import type { RazorpayOrder } from "../lib/razorpay";

export type DamageChargeType = "PENALTY" | "COMPENSATION";

export interface DamageReport {
  damageReportId: string;
  status: string;
  chargeType: DamageChargeType;
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
  damageDetails: Record<string, any>;
  images: { url: string }[];
  financialHint: {
    deposit: number;
    additionalCharges: number;
    estimatedCost: number;
    gstRate: number;
  };
}

export interface CloseDamagePayload {
  disposition: "AVAILABLE" | "MAINTENANCE" | "DAMAGED";
  finalCost: number;
  paymentMethod?: "CASH" | "ONLINE_RAZORPAY" | "SPLIT";
  cashAmount?: number;
  onlineAmount?: number;
  onlineTransactionRef?: string;
}

export interface CloseDamageResponse {
  message: string;
  refunded: boolean;
  settled: boolean;
  razorpay?: RazorpayOrder;
  transactionId?: string;
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
