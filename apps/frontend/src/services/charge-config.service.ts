import apiClient from "@/lib/axios";

export interface BranchChargeConfig {
  branchId?: number;
  extraKmEnabled: boolean;
  extraTimeEnabled: boolean;
  fuelModuleEnabled: boolean;
  fastagModuleEnabled: boolean;
  gracePolicyEnabled: boolean;
  damageModuleEnabled: boolean;
  graceType: "AUTOMATIC" | "MANUAL";
  graceMinutes: number;
  employeeOverrideEnabled: boolean;
  maxOverridePercent: number | null;
  overrideRequiresApproval: boolean;
  overrideApprovalThreshold: number | null;
  safetyDepositEnabled: boolean;
  safetyDepositRequiresApproval: boolean;
  usePaymentSessions: boolean;
}

export const chargeConfigService = {
  getConfig: async (): Promise<{ data: BranchChargeConfig }> => {
    const res = await apiClient.get("/branchManager/charge-config");
    return res.data;
  },

  upsertConfig: async (
    data: Partial<BranchChargeConfig>,
  ): Promise<{ data: BranchChargeConfig; message: string }> => {
    const res = await apiClient.put("/branchManager/charge-config", data);
    return res.data;
  },
};
