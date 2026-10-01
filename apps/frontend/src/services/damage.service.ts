import axios from "../lib/axios";
import type { RazorpayOrder } from "../lib/razorpay";

export type DamageChargeType = "PENALTY" | "COMPENSATION";

export interface DamageReport {
  damageReportId: string;
  status: string;
  chargeType: DamageChargeType;
  /**
   * Billed to the customer in the RETURN session at drop — the manager only
   * sets the vehicle disposition; closing must not charge again.
   */
  chargedAtDrop?: boolean;
  /** Recorded by staff while closing the drop (notes.source === "DROP"). */
  raisedAtDrop?: boolean;
  /**
   * true → normal review/payment. false → the manager only sets the disposition
   * (charged at drop, or a company expense).
   */
  managerCharges?: boolean;
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
    finalCost?: number | null;
    /** CGST + SGST %; null when the branch has no GST rule (no silent 18%). */
    gstRate: number | null;
    cgstRate?: number | null;
    sgstRate?: number | null;
    /** True when the branch has no GST rule: a PENALTY close is refused (409 GST_RULE_MISSING). */
    gstRuleMissing?: boolean;
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
  refunded?: boolean;
  settled: boolean;
  /** Drop damage closes only set the disposition. */
  chargedAtDrop?: boolean;
  vehicleStatus?: string | null;
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
