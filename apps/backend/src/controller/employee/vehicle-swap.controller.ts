import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, SwapReason } from "@repo/database/client";
import {
  VehicleSwapService,
  swapErrorResponse,
} from "../../services/vehicle-swap/vehicle-swap.service.js";
import { vehicleSwapSchema } from "@repo/schemas";
import { z } from "zod";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import Decimal from "decimal.js";
import {
  resolveKmAllowance,
  type KmAllowance,
} from "../../services/charges/km-allowance.service.js";

const vehicleSwapService = new VehicleSwapService();

/**
 * Get available vehicles for swap (employee context)
 * GET /api/employee/bookings/:bookingId/available-vehicles
 *
 * data: candidates (same category first, upgrades flagged) with the per-car
 * price-difference preview; swapContext: stage, readings rule, current car.
 */
export const GetAvailableVehiclesForEmployee = async (
  req: Request,
  res: Response,
) => {
  const branchId = req.branch_Id;
  const { bookingId } = req.params;

  if (!bookingId) {
    return res
      .status(StatusCode.BAD_REQUEST)
      .json({ success: false, code: "VALIDATION_ERROR", message: "Booking ID is required" });
  }

  try {
    const { vehicles, excluded, context } =
      await vehicleSwapService.getAvailableVehiclesForSwap(bookingId, branchId);

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Available vehicles fetched successfully",
      data: vehicles,
      swapContext: context,
      // Same-type cars that can't take over the booking, with the reason
      excluded,
    });
  } catch (error: unknown) {
    console.error("Error fetching available vehicles for swap:", error);
    const { status, body } = swapErrorResponse(error, "Failed to fetch available vehicles");
    return res.status(status).json(body);
  }
};

/**
 * Perform vehicle swap (employee context)
 * POST /api/employee/bookings/:bookingId/swap-vehicle
 *
 * A PICKED_UP booking needs all four readings (READINGS_REQUIRED otherwise).
 */
export const SwapVehicleByEmployee = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    return res
      .status(StatusCode.BAD_REQUEST)
      .json({ success: false, code: "VALIDATION_ERROR", message: "Booking ID is required" });
  }

  const validation = vehicleSwapSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: validation.error.errors[0]?.message ?? "Validation failed",
      errors: validation.error.errors.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      })),
    });
  }

  const body = validation.data;

  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true },
    });

    if (!user) {
      return res
        .status(StatusCode.UNAUTHORIZED)
        .json({ success: false, message: "Staff user not found" });
    }

    const swap = await vehicleSwapService.swapVehicle({
      bookingPublicId: bookingId,
      newVehicleId: body.newVehicleId,
      swappedById: user.id,
      reason: body.reason as SwapReason,
      reasonNotes: body.reasonNotes,
      markOriginalForMaintenance: body.markOriginalForMaintenance === true,
      originalVehicleNotes: body.originalVehicleNotes,
      originalVehicleEndOdometer: body.originalVehicleEndOdometer,
      originalVehicleFuelLevel: body.originalVehicleFuelLevel,
      newVehicleStartOdometer: body.newVehicleStartOdometer,
      newVehicleFuelLevel: body.newVehicleFuelLevel,
      chargeDifference: body.chargeDifference,
      branchId: req.branch_Id,
      source: "STAFF",
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.SWAPPED,
      entityType: StaffEntityType.VEHICLE,
      entityRef: bookingId,
      description:
        `Vehicle swapped in booking ${bookingId}: ${swap.originalVehicle.regNo} → ${swap.newVehicle.regNo} — reason: ${body.reason}`,
      metadata: {
        swapPublicId: swap.publicId,
        bookingStatusAtSwap: swap.bookingStatusAtSwap,
        originalVehicle: swap.originalVehicle.regNo,
        newVehicle: swap.newVehicle.regNo,
        reason: body.reason,
        reasonNotes: body.reasonNotes,
        priceDifference: swap.priceDifference.toString(),
        chargeDifference: swap.chargeDifference,
      },
    });

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Vehicle swapped successfully",
      data: swap,
    });
  } catch (error: unknown) {
    console.error("Error performing vehicle swap:", error);
    const { status, body: errorBody } = swapErrorResponse(error, "Failed to perform vehicle swap");
    return res.status(status).json(errorBody);
  }
};

/**
 * Swap history of one booking of this branch (newest first)
 * GET /api/employee/bookings/:bookingId/swap-history
 */
export const GetBookingSwapHistoryForEmployee = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    return res
      .status(StatusCode.BAD_REQUEST)
      .json({ success: false, code: "VALIDATION_ERROR", message: "Booking ID is required" });
  }

  try {
    const history = await vehicleSwapService.getBookingSwapHistory(bookingId, req.branch_Id);
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Booking swap history fetched successfully",
      data: history,
    });
  } catch (error: unknown) {
    console.error("Error fetching booking swap history:", error);
    const { status, body } = swapErrorResponse(error, "Failed to fetch booking swap history");
    return res.status(status).json(body);
  }
};

const recentSwapsQuerySchema = z.object({
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  reason: z.nativeEnum(SwapReason).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const RECENT_SWAPS_DEFAULT_DAYS = 30;

/**
 * Recent swaps across this branch (newest first)
 * GET /api/employee/swap-history?startDate&endDate&vehicleId&reason&limit
 * Defaults: the last 30 days, at most 50 rows.
 */
export const GetRecentSwapsForEmployee = async (req: Request, res: Response) => {
  const validation = recentSwapsQuerySchema.safeParse(req.query);
  if (!validation.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: validation.error.issues[0]?.message ?? "Validation failed",
      errors: validation.error.issues.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      })),
    });
  }

  const { startDate, endDate, vehicleId, reason, limit } = validation.data;
  const end = endDate ? new Date(endDate) : new Date();
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - RECENT_SWAPS_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  if (start > end) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Start date must be before end date",
    });
  }

  try {
    const history = await vehicleSwapService.getSwapsByDateRange(
      req.branch_Id,
      start,
      end,
      { vehicleId, reason },
      limit ?? 50,
    );
    return res.status(StatusCode.OK).json({
      success: true,
      message: "Swap history fetched successfully",
      data: history,
      filters: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        vehicleId: vehicleId ?? null,
        reason: reason ?? null,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching swap history:", error);
    const { status, body } = swapErrorResponse(error, "Failed to fetch swap history");
    return res.status(status).json(body);
  }
};

/**
 * Get vehicle pricing rules for the pickup confirmation popup
 * GET /api/employee/pickup/:bookingId/pricing-rules
 */
export const GetPickupPricingRules = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    return res
      .status(StatusCode.BAD_REQUEST)
      .json({ message: "Booking ID is required" });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId: req.branch_Id },
      select: {
        id: true,
        branchId: true,
        startAt: true,
        endAt: true,
        frozenChargeConfig: true,
        branch: { select: { chargeConfig: { select: { extraKmEnabled: true } } } },
        items: {
          orderBy: { id: "asc" },
          take: 1,
          select: {
            vehicle: {
              select: {
                make: true,
                model: true,
                regNo: true,
                categoryId: true,
                customPricing: {
                  select: {
                    enabled: true,
                    freeKm24Hour: true,
                    freeKmMonthly: true,
                    extraKmRate: true,
                    extraHourRate: true,
                    price24Hour: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!booking) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Booking not found" });
    }

    const vehicle = booking.items[0]?.vehicle;
    if (!vehicle) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: "Vehicle not found for booking" });
    }

    // The rates the pricing engine bills with: the vehicle's custom pricing when
    // enabled, else the branch default for its category. (VehiclePricingOverride
    // and BranchPricingSetting carry no km/hour rates — reading them gave ₹0/km.)
    const usesCustomPricing = vehicle.customPricing?.enabled === true;
    const config = usesCustomPricing
      ? vehicle.customPricing
      : await prisma.branchPricingDefaults.findUnique({
          where: {
            branchId_categoryId: { branchId: booking.branchId, categoryId: vehicle.categoryId },
          },
          select: {
            freeKm24Hour: true,
            freeKmMonthly: true,
            extraKmRate: true,
            extraHourRate: true,
            price24Hour: true,
          },
        });

    // This booking's own allowance — the plan-based free km and rate the drop
    // bills with. If it can't be worked out, report none rather than a guess.
    let allowance: KmAllowance | null = null;
    try {
      allowance = await resolveKmAllowance(booking.id);
    } catch (allowanceErr) {
      console.warn(`[pickup-pricing-rules] Km allowance unavailable for ${bookingId}:`, allowanceErr);
    }
    const extraKmEnabled =
      allowance?.extraKmEnabled ?? booking.branch.chargeConfig?.extraKmEnabled ?? true;

    const rules = {
      vehicle: {
        make: vehicle.make,
        model: vehicle.model,
        regNo: vehicle.regNo,
      },
      pricing: config
        ? {
            freeKm24Hour: config.freeKm24Hour,
            freeKmMonthly: config.freeKmMonthly,
            extraKmRate: (allowance?.extraKmRate ?? new Decimal(config.extraKmRate.toString())).toFixed(2),
            extraHourRate: new Decimal(config.extraHourRate.toString()).toFixed(2),
            price24Hour: new Decimal(config.price24Hour.toString()).toFixed(2),
            // Free km for this booking's whole period (null when it can't be worked out)
            includedKm: allowance?.includedKm ?? null,
            extraKmEnabled,
            source: usesCustomPricing ? "vehicle_custom" : "branch_default",
          }
        : null,
      kmAllowance: allowance
        ? {
            includedKm: allowance.includedKm,
            // includedKm = original period's free km + the free km extensions add (#7)
            freeKmOriginal: allowance.freeKmOriginal,
            freeKmExtensions: allowance.freeKmExtensions,
            extensionCount: allowance.extensionCount,
            extraKmRate: allowance.extraKmRate.toFixed(2),
            extraKmEnabled: allowance.extraKmEnabled,
          }
        : null,
      frozenChargeConfig: booking.frozenChargeConfig,
      rentalPeriod: {
        start: booking.startAt,
        end: booking.endAt,
      },
    };

    return res.status(StatusCode.OK).json({
      message: "Pricing rules fetched successfully",
      data: rules,
    });
  } catch (error: any) {
    console.error("Error fetching pricing rules:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message || "Failed to fetch pricing rules",
    });
  }
};
