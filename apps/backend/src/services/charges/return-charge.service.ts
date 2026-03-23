import Decimal from "decimal.js";
import { DateTime } from "luxon";
import { prisma } from "@repo/database/client";
import { chargeEngineService } from "./charge-engine.service.js";
import type { ChargeBreakdown, ChargeContext, FrozenChargeConfig } from "../../types/charge-engine.types.js";
import { DEFAULT_FROZEN_CHARGE_CONFIG } from "../../types/charge-engine.types.js";
import type { ChargeReturnDataInput } from "../../types/charge-return.types.js";
import { createID } from "../../utils/nanoID.js";

/**
 * Orchestrates all charge computation at vehicle return:
 *  1. Validates return input against frozenChargeConfig
 *  2. Updates FuelRecord if fuel module enabled
 *  3. Builds ChargeContext and calls ChargeEngineService
 *  4. Persists ChargeEntry records
 *  5. Updates booking with return metrics
 */
export class ReturnChargeService {
  async processReturnCharges(
    bookingPublicId: string,
    endOdometer: number,
    returnInput: ChargeReturnDataInput,
    actorId: number,
  ): Promise<ChargeBreakdown> {
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingPublicId },
      include: {
        items: { include: { vehicle: { select: { id: true, hasFastag: true, fastagNumber: true } } } },
        fuelRecord: true,
      },
    });

    if (!booking) throw new Error("Booking not found");
    if (booking.status !== "PICKED_UP") {
      throw new Error("Charges can only be processed for a booking in PICKED_UP status");
    }

    const frozenConfig = (booking.frozenChargeConfig as FrozenChargeConfig | null)
      ?? DEFAULT_FROZEN_CHARGE_CONFIG;

    // Validate fuel input
    if (frozenConfig.fuelModuleEnabled) {
      if (!returnInput.returnFuelLevel) {
        throw new Error("Return fuel level is required when fuel module is enabled");
      }
    }

    // Validate fastag input
    const vehicle = booking.items[0]?.vehicle;
    if (frozenConfig.fastagModuleEnabled && vehicle?.hasFastag) {
      if (returnInput.fastagAmount === undefined) {
        throw new Error("FASTag amount is required when FASTag module is enabled and vehicle has FASTag");
      }
    }

    // Compute time metrics
    const actualReturnAt = new Date();
    const startAt = booking.startAt;
    const endAt = booking.endAt;
    const actualHoursDecimal = DateTime.fromJSDate(actualReturnAt)
      .diff(DateTime.fromJSDate(startAt), "hours").hours;
    const actualHours = Math.max(0, actualHoursDecimal);

    // Compute distance
    const startOdometer = booking.startOdometer ?? 0;
    const totalKmDriven = Math.max(0, endOdometer - startOdometer);

    // Get vehicle pricing snapshot
    const vehicleItem = booking.items[0];
    if (!vehicleItem) throw new Error("No vehicle found on booking");

    const vehiclePricingDb = await prisma.vehicleCustomPricing.findUnique({
      where: { vehicleId: vehicleItem.vehicleId },
    });

    const branchDefaults = vehiclePricingDb
      ? null
      : await (async () => {
          const v = await prisma.vehicle.findUnique({
            where: { id: vehicleItem.vehicleId },
            select: { categoryId: true },
          });
          if (!v) throw new Error("Vehicle not found");
          return prisma.branchPricingDefaults.findUnique({
            where: { branchId_categoryId: { branchId: booking.branchId, categoryId: v.categoryId } },
          });
        })();

    const pricing = vehiclePricingDb ?? branchDefaults;
    if (!pricing) throw new Error("No pricing configured for this vehicle");

    const freeKmLimit = booking.freeKmLimit ?? (pricing as any).freeKm24Hour ?? 150;

    const vehiclePricingSnapshot = {
      vehicleId: vehicleItem.vehicleId,
      hasFastag: vehicle?.hasFastag ?? false,
      fastagNumber: vehicle?.fastagNumber ?? null,
      extraKmRate: new Decimal(pricing.extraKmRate.toString()),
      extraHourRate: new Decimal(pricing.extraHourRate.toString()),
      freeKmLimit,
    };

    // Build ChargeContext
    const context: ChargeContext = {
      bookingId: booking.id,
      bookingPublicId: booking.publicId,
      branchId: booking.branchId,
      frozenConfig,
      vehiclePricing: vehiclePricingSnapshot,
      baseAmount: new Decimal(booking.totalBase.toString()),
      startAt,
      endAt,
      actualReturnAt,
      actualHours,
      billableHours: Number(booking.billableHours ?? 0),
      startOdometer,
      endOdometer,
      totalKmDriven,
      applyGrace: returnInput.applyGrace,
      pickupFuelLevel: booking.fuelRecord?.pickupFuelLevel ?? undefined,
      returnFuelLevel: returnInput.returnFuelLevel as any,
      fuelDeficitCharge: returnInput.fuelDeficitCharge != null
        ? new Decimal(returnInput.fuelDeficitCharge)
        : undefined,
      fuelSkipReason: returnInput.fuelSkipReason,
      fastagAmount: returnInput.fastagAmount != null
        ? new Decimal(returnInput.fastagAmount)
        : undefined,
      fastagNotes: returnInput.fastagNotes,
      actorId,
    };

    // Run charge engine and persist entries — inside a transaction
    let breakdown: ChargeBreakdown;

    await prisma.$transaction(async (tx) => {
      breakdown = await chargeEngineService.computeCharges(context);
      await chargeEngineService.persistChargeEntries(booking.id, breakdown!, actorId, tx as any);

      // Update FuelRecord if fuel module enabled
      if (frozenConfig.fuelModuleEnabled && booking.fuelRecord) {
        await tx.fuelRecord.update({
          where: { bookingId: booking.id },
          data: {
            returnFuelLevel: returnInput.returnFuelLevel as any,
            returnAt: actualReturnAt,
            capturedByReturnId: actorId,
            fuelDeficit: (context.pickupFuelLevel !== context.returnFuelLevel)
              && (context.returnFuelLevel !== undefined),
            fuelDeficitCharge: context.fuelDeficitCharge
              ? context.fuelDeficitCharge.toFixed(2)
              : null,
            skipReason: returnInput.fuelSkipReason ?? null,
          },
        });
      }

      // Update booking with return metrics and increment version
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          endOdometer,
          totalKmDriven,
          actualHours: String(actualHours),
          chargeConfigVersion: { increment: 1 },
        },
      });
    });

    return breakdown!;
  }
}

export const returnChargeService = new ReturnChargeService();
