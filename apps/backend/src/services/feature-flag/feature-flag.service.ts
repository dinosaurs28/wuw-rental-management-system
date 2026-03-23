/**
 * Feature Flag Service
 *
 * Provides flag checks with a 3-level hierarchy:
 *   Vehicle > Branch > System
 *
 * Uses in-memory caching (5 min TTL) to minimise DB load.
 */

import { prisma } from "@repo/database/client";
import type { FeatureFlag, BranchFeatureFlag, VehicleFeatureFlag } from "@repo/database/client";
import { FeatureFlagKey } from "../../config/feature-flags.config.js";
import { flagCache as cache } from "../../utils/flag-cache.util.js";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface FlagStatus {
  enabled: boolean;
  source: "vehicle" | "branch" | "system";
  config?: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE CLASS
// ─────────────────────────────────────────────────────────────────────────────

class FeatureFlagService {
  // ──────────────────────────────────────────
  // FLAG CHECKING
  // ──────────────────────────────────────────

  /**
   * Check if a SYSTEM-level flag is enabled.
   *
   * Flow: Cache → DB → Cache + return
   */
  async isEnabled(flagKey: FeatureFlagKey): Promise<boolean> {
    const key = `flag:system:${flagKey}`;
    const cached = cache.get<boolean>(key);
    if (cached !== null) return cached;

    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
      select: { enabled: true },
    });

    const result = flag?.enabled ?? false;
    cache.set(key, result);
    return result;
  }

  /**
   * Check if a flag is enabled for a specific BRANCH.
   * Priority: Branch Override > System Default
   */
  async isEnabledForBranch(
    flagKey: FeatureFlagKey,
    branchId: number
  ): Promise<boolean> {
    const key = `flag:branch:${branchId}:${flagKey}`;
    const cached = cache.get<boolean>(key);
    if (cached !== null) return cached;

    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
      include: {
        branchFlags: {
          where: { branchId },
          select: { enabled: true },
        },
      },
    });

    if (!flag) {
      cache.set(key, false);
      return false;
    }

    const branchOverride = flag.branchFlags[0];
    const result =
      branchOverride !== undefined ? branchOverride.enabled : flag.enabled;

    cache.set(key, result);
    return result;
  }

  /**
   * Check if a flag is enabled for a specific VEHICLE.
   * Priority: Vehicle > Branch > System
   */
  async isEnabledForVehicle(
    flagKey: FeatureFlagKey,
    vehicleId: number
  ): Promise<boolean> {
    const key = `flag:vehicle:${vehicleId}:${flagKey}`;
    const cached = cache.get<boolean>(key);
    if (cached !== null) return cached;

    // Get vehicle's branchId
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { branchId: true },
    });

    if (!vehicle) {
      cache.set(key, false);
      return false;
    }

    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
      include: {
        vehicleFlags: {
          where: { vehicleId },
          select: { enabled: true },
        },
        branchFlags: {
          where: { branchId: vehicle.branchId },
          select: { enabled: true },
        },
      },
    });

    if (!flag) {
      cache.set(key, false);
      return false;
    }

    let result: boolean;
    if (flag.vehicleFlags.length > 0) {
      result = flag.vehicleFlags[0]!.enabled;
    } else if (flag.branchFlags.length > 0) {
      result = flag.branchFlags[0]!.enabled;
    } else {
      result = flag.enabled;
    }

    cache.set(key, result);
    return result;
  }

  // ──────────────────────────────────────────
  // CONFIG RETRIEVAL
  // ──────────────────────────────────────────

  async getConfig(
    flagKey: FeatureFlagKey,
    scope?: { branchId?: number; vehicleId?: number }
  ): Promise<any | null> {
    const flag = await (prisma.featureFlag.findUnique as any)({
      where: { key: flagKey },
      include: {
        vehicleFlags: scope?.vehicleId
          ? { where: { vehicleId: scope.vehicleId }, select: { config: true } }
          : false,
        branchFlags: scope?.branchId
          ? { where: { branchId: scope.branchId }, select: { config: true } }
          : false,
      },
    });

    if (!flag) return null;

    if (scope?.vehicleId && flag.vehicleFlags?.[0]?.config)
      return flag.vehicleFlags[0].config;
    if (scope?.branchId && flag.branchFlags?.[0]?.config)
      return flag.branchFlags[0].config;

    return flag.config ?? null;
  }

  // ──────────────────────────────────────────
  // ADMIN MANAGEMENT
  // ──────────────────────────────────────────

  /** Get all feature flags. */
  async getAllFlags(): Promise<FeatureFlag[]> {
    return prisma.featureFlag.findMany({
      orderBy: [{ scope: "asc" }, { key: "asc" }],
    });
  }

  /** Update a system-level flag and clear its cache. */
  async updateFlag(
    flagKey: FeatureFlagKey,
    enabled: boolean,
    config?: any
  ): Promise<FeatureFlag> {
    const updated = await prisma.featureFlag.update({
      where: { key: flagKey },
      data: {
        enabled,
        ...(config !== undefined && { config }),
      },
    });

    cache.clearPattern(`flag:system:${flagKey}`);
    cache.clearPattern(`flag:branch:*:${flagKey}`);
    cache.clearPattern(`flag:vehicle:*:${flagKey}`);

    return updated;
  }

  /** Upsert a branch-level override. */
  async setBranchFlag(
    branchId: number,
    flagKey: FeatureFlagKey,
    enabled: boolean,
    config?: any
  ): Promise<BranchFeatureFlag> {
    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
    });
    if (!flag) throw new Error(`Flag '${flagKey}' not found`);

    const result = await prisma.branchFeatureFlag.upsert({
      where: { branchId_flagId: { branchId, flagId: flag.id } },
      create: { branchId, flagId: flag.id, enabled, config },
      update: { enabled, ...(config !== undefined && { config }) },
    });

    cache.delete(`flag:branch:${branchId}:${flagKey}`);
    cache.clearPattern(`flag:vehicle:*:${flagKey}`);

    return result;
  }

  /** Upsert a vehicle-level override. */
  async setVehicleFlag(
    vehicleId: number,
    flagKey: FeatureFlagKey,
    enabled: boolean,
    config?: any
  ): Promise<VehicleFeatureFlag> {
    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
    });
    if (!flag) throw new Error(`Flag '${flagKey}' not found`);

    const result = await prisma.vehicleFeatureFlag.upsert({
      where: { vehicleId_flagId: { vehicleId, flagId: flag.id } },
      create: { vehicleId, flagId: flag.id, enabled, config },
      update: { enabled, ...(config !== undefined && { config }) },
    });

    cache.delete(`flag:vehicle:${vehicleId}:${flagKey}`);
    return result;
  }

  /** Remove branch-level override (reverts to system default). */
  async removeBranchFlag(branchId: number, flagKey: FeatureFlagKey): Promise<void> {
    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
    });
    if (!flag) throw new Error(`Flag '${flagKey}' not found`);

    await prisma.branchFeatureFlag.delete({
      where: { branchId_flagId: { branchId, flagId: flag.id } },
    });

    cache.delete(`flag:branch:${branchId}:${flagKey}`);
    cache.clearPattern(`flag:vehicle:*:${flagKey}`);
  }

  /** Remove vehicle-level override. */
  async removeVehicleFlag(vehicleId: number, flagKey: FeatureFlagKey): Promise<void> {
    const flag = await prisma.featureFlag.findUnique({
      where: { key: flagKey },
    });
    if (!flag) throw new Error(`Flag '${flagKey}' not found`);

    await prisma.vehicleFeatureFlag.delete({
      where: { vehicleId_flagId: { vehicleId, flagId: flag.id } },
    });

    cache.delete(`flag:vehicle:${vehicleId}:${flagKey}`);
  }

  // ──────────────────────────────────────────
  // BULK READS
  // ──────────────────────────────────────────

  /** Get all flag statuses for a branch with their source. */
  async getBranchFlags(branchId: number): Promise<Record<string, FlagStatus>> {
    const flags = await prisma.featureFlag.findMany({
      include: {
        branchFlags: { where: { branchId } },
      },
    });

    const result: Record<string, FlagStatus> = {};
    for (const flag of flags) {
      const branch = flag.branchFlags[0];
      result[flag.key] = {
        enabled: branch !== undefined ? branch.enabled : flag.enabled,
        source: branch !== undefined ? "branch" : "system",
        config: branch?.config ?? flag.config,
      };
    }
    return result;
  }

  /** Get all flag statuses for a vehicle with their source. */
  async getVehicleFlags(
    vehicleId: number
  ): Promise<Record<string, FlagStatus>> {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { branchId: true },
    });
    if (!vehicle) return {};

    const flags = await prisma.featureFlag.findMany({
      include: {
        vehicleFlags: { where: { vehicleId } },
        branchFlags: { where: { branchId: vehicle.branchId } },
      },
    });

    const result: Record<string, FlagStatus> = {};
    for (const flag of flags) {
      const vehicleOverride = flag.vehicleFlags[0];
      const branchOverride = flag.branchFlags[0];

      if (vehicleOverride) {
        result[flag.key] = {
          enabled: vehicleOverride.enabled,
          source: "vehicle",
          config: vehicleOverride.config,
        };
      } else if (branchOverride) {
        result[flag.key] = {
          enabled: branchOverride.enabled,
          source: "branch",
          config: branchOverride.config,
        };
      } else {
        result[flag.key] = {
          enabled: flag.enabled,
          source: "system",
          config: flag.config,
        };
      }
    }
    return result;
  }

  // ──────────────────────────────────────────
  // CACHE MANAGEMENT
  // ──────────────────────────────────────────

  async clearCache() {
    cache.clearAll();
  }

  async clearFlagCache(flagKey: FeatureFlagKey) {
    cache.clearPattern(`flag:system:${flagKey}`);
    cache.clearPattern(`flag:branch:*:${flagKey}`);
    cache.clearPattern(`flag:vehicle:*:${flagKey}`);
  }
}

export const featureFlagService = new FeatureFlagService();
export default featureFlagService;
