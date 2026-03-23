/** Input type for creating or updating branch charge configuration. */
export interface BranchChargeConfigInput {
  extraKmEnabled?: boolean;
  extraTimeEnabled?: boolean;
  fuelModuleEnabled?: boolean;
  fastagModuleEnabled?: boolean;
  gracePolicyEnabled?: boolean;
  damageModuleEnabled?: boolean;
  graceType?: "AUTOMATIC" | "MANUAL";
  graceMinutes?: number;
  employeeOverrideEnabled?: boolean;
  maxOverridePercent?: number | null;
  overrideRequiresApproval?: boolean;
  overrideApprovalThreshold?: number | null;
  safetyDepositEnabled?: boolean;
  safetyDepositRequiresApproval?: boolean;
}
