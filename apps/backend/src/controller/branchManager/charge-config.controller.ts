import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { z } from "zod";

const branchChargeConfigSchema = z.object({
  extraKmEnabled: z.boolean().optional(),
  extraTimeEnabled: z.boolean().optional(),
  fuelModuleEnabled: z.boolean().optional(),
  fastagModuleEnabled: z.boolean().optional(),
  gracePolicyEnabled: z.boolean().optional(),
  damageModuleEnabled: z.boolean().optional(),
  graceType: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
  graceMinutes: z.coerce.number().int().min(0).max(120).optional(),
  employeeOverrideEnabled: z.boolean().optional(),
  maxOverridePercent: z.coerce.number().min(0).max(100).nullable().optional(),
  overrideRequiresApproval: z.boolean().optional(),
  overrideApprovalThreshold: z.coerce.number().min(0).nullable().optional(),
  safetyDepositEnabled: z.boolean().optional(),
  safetyDepositRequiresApproval: z.boolean().optional(),
});
import { chargeConfigService } from "../../services/charges/charge-config.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";

export const GetBranchChargeConfig = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const config = await chargeConfigService.getConfig(branchId);

    if (!config) {
      // Return safe defaults when not yet configured
      return res.status(StatusCode.OK).json({
        data: {
          branchId,
          extraKmEnabled: true,
          extraTimeEnabled: true,
          fuelModuleEnabled: false,
          fastagModuleEnabled: false,
          gracePolicyEnabled: false,
          damageModuleEnabled: true,
          graceType: "AUTOMATIC",
          graceMinutes: 15,
          employeeOverrideEnabled: false,
          maxOverridePercent: null,
          overrideRequiresApproval: false,
          overrideApprovalThreshold: null,
          safetyDepositEnabled: false,
          safetyDepositRequiresApproval: true,
        },
      });
    }

    return res.status(StatusCode.OK).json({ data: config });
  } catch (error) {
    console.error("GetBranchChargeConfig Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal server error" });
  }
};

export const UpsertBranchChargeConfig = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;

    const validation = branchChargeConfigSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const config = await chargeConfigService.upsertConfig(branchId, validation.data);

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.UPDATED,
      entityType: StaffEntityType.BRANCH_CHARGE_CONFIG,
      entityRef: String(branchId),
      description: "Branch charge module configuration updated",
      metadata: validation.data as Record<string, unknown>,
    });

    return res.status(StatusCode.OK).json({
      message: "Branch charge config updated",
      data: config,
    });
  } catch (error) {
    console.error("UpsertBranchChargeConfig Error:", error);
    return res
      .status(StatusCode.INTERNAL_SERVER_ERROR)
      .json({ message: "Internal server error" });
  }
};
