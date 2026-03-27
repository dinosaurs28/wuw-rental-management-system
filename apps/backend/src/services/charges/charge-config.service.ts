import type { BranchChargeConfig } from "@repo/database/client";
import { prisma } from "@repo/database/client";
import type { FrozenChargeConfig } from "../../types/charge-engine.types.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG } from "../../types/charge-engine.types.js";
import { createID } from "../../utils/nanoID.js";
import type { BranchChargeConfigInput } from "../../types/charge-config.types.js";

/**
 * Manages BranchChargeConfig CRUD and produces the frozen snapshot
 * that gets stored immutably on each booking at creation time.
 */
export class ChargeConfigService {
  /**
   * Get the live charge config for a branch.
   * Returns null if not yet configured.
   */
  async getConfig(branchId: number): Promise<BranchChargeConfig | null> {
    return prisma.branchChargeConfig.findUnique({
      where: { branchId },
    });
  }

  /**
   * Upsert branch charge configuration.
   * Creates the record if it does not exist; merges if it does.
   */
  async upsertConfig(branchId: number, data: BranchChargeConfigInput): Promise<BranchChargeConfig> {
    const existing = await prisma.branchChargeConfig.findUnique({
      where: { branchId },
    });

    const payload = {
      extraKmEnabled: data.extraKmEnabled ?? true,
      extraTimeEnabled: data.extraTimeEnabled ?? true,
      fuelModuleEnabled: data.fuelModuleEnabled ?? false,
      fastagModuleEnabled: data.fastagModuleEnabled ?? false,
      gracePolicyEnabled: data.gracePolicyEnabled ?? false,
      damageModuleEnabled: data.damageModuleEnabled ?? true,
      graceType: (data.graceType ?? "AUTOMATIC") as "AUTOMATIC" | "MANUAL",
      graceMinutes: data.graceMinutes ?? 15,
      employeeOverrideEnabled: data.employeeOverrideEnabled ?? false,
      maxOverridePercent: data.maxOverridePercent != null
        ? String(data.maxOverridePercent)
        : null,
      overrideRequiresApproval: data.overrideRequiresApproval ?? false,
      overrideApprovalThreshold: data.overrideApprovalThreshold != null
        ? String(data.overrideApprovalThreshold)
        : null,
      safetyDepositEnabled: data.safetyDepositEnabled ?? false,
      safetyDepositRequiresApproval: data.safetyDepositRequiresApproval ?? true,
      usePaymentSessions: data.usePaymentSessions ?? false,
    };

    if (existing) {
      return prisma.branchChargeConfig.update({
        where: { branchId },
        data: payload,
      });
    }

    return prisma.branchChargeConfig.create({
      data: {
        publicId: createID(),
        branchId,
        ...payload,
      },
    });
  }

  /**
   * Produce an immutable FrozenChargeConfig snapshot for a branch.
   * If no config exists, returns the system-wide safe defaults.
   * This snapshot is stored as JSON on the booking at creation time.
   */
  async freezeChargeConfig(branchId: number): Promise<FrozenChargeConfig> {
    const config = await this.getConfig(branchId);

    if (!config) {
      return { ...DEFAULT_FROZEN_CHARGE_CONFIG };
    }

    return {
      extraKmEnabled: config.extraKmEnabled,
      extraTimeEnabled: config.extraTimeEnabled,
      fuelModuleEnabled: config.fuelModuleEnabled,
      fastagModuleEnabled: config.fastagModuleEnabled,
      gracePolicyEnabled: config.gracePolicyEnabled,
      damageModuleEnabled: config.damageModuleEnabled,
      graceType: config.graceType,
      graceMinutes: config.graceMinutes,
      employeeOverrideEnabled: config.employeeOverrideEnabled,
      maxOverridePercent: config.maxOverridePercent
        ? Number(config.maxOverridePercent.toString())
        : null,
      overrideRequiresApproval: config.overrideRequiresApproval,
      overrideApprovalThreshold: config.overrideApprovalThreshold
        ? Number(config.overrideApprovalThreshold.toString())
        : null,
      safetyDepositEnabled: config.safetyDepositEnabled,
      safetyDepositRequiresApproval: config.safetyDepositRequiresApproval,
    };
  }
}

export const chargeConfigService = new ChargeConfigService();
