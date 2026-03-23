import { z } from "zod";

export const branchChargeConfigSchema = z.object({
  extraKmEnabled: z.boolean().default(true),
  extraTimeEnabled: z.boolean().default(true),
  fuelModuleEnabled: z.boolean().default(false),
  fastagModuleEnabled: z.boolean().default(false),
  gracePolicyEnabled: z.boolean().default(false),
  damageModuleEnabled: z.boolean().default(true),

  // Grace sub-options — only meaningful when gracePolicyEnabled = true
  graceType: z.enum(["AUTOMATIC", "MANUAL"]).default("AUTOMATIC"),
  graceMinutes: z.coerce.number().int().min(0).max(120).default(15),

  // Override config
  employeeOverrideEnabled: z.boolean().default(false),
  maxOverridePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  overrideRequiresApproval: z.boolean().default(false),
  overrideApprovalThreshold: z.coerce.number().min(0).nullable().optional(),

  // Safety deposit config
  safetyDepositEnabled: z.boolean().default(false),
  safetyDepositRequiresApproval: z.boolean().default(true),
});

export const updateBranchChargeConfigSchema = branchChargeConfigSchema.partial();

export type BranchChargeConfigInput = z.infer<typeof branchChargeConfigSchema>;
export type UpdateBranchChargeConfigInput = z.infer<typeof updateBranchChargeConfigSchema>;
