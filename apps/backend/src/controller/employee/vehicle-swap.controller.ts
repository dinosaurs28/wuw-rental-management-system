import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, SwapReason } from "@repo/database/client";
import { VehicleSwapService } from "../../services/vehicle-swap/vehicle-swap.service.js";
import { vehicleSwapSchema } from "@repo/schemas";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import Decimal from "decimal.js";

const vehicleSwapService = new VehicleSwapService();

/**
 * Get available vehicles for swap (employee context)
 * GET /api/employee/bookings/:bookingId/available-vehicles
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
      .json({ message: "Booking ID is required" });
  }

  try {
    const availableVehicles =
      await vehicleSwapService.getAvailableVehiclesForSwap(bookingId, branchId);

    return res.status(StatusCode.OK).json({
      message: "Available vehicles fetched successfully",
      data: availableVehicles,
    });
  } catch (error: any) {
    console.error("Error fetching available vehicles for swap:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message || "Failed to fetch available vehicles",
    });
  }
};

/**
 * Perform vehicle swap (employee context)
 * POST /api/employee/bookings/:bookingId/swap-vehicle
 */
export const SwapVehicleByEmployee = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    return res
      .status(StatusCode.BAD_REQUEST)
      .json({ message: "Booking ID is required" });
  }

  const validation = vehicleSwapSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Validation failed",
      errors: validation.error.errors.map((err) => ({
        field: err.path.join("."),
        message: err.message,
      })),
    });
  }

  const {
    newVehicleId,
    reason,
    reasonNotes,
    markOriginalForMaintenance,
    originalVehicleNotes,
  } = validation.data;

  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true },
    });

    if (!user) {
      return res
        .status(StatusCode.UNAUTHORIZED)
        .json({ message: "Staff user not found" });
    }

    const swap = await vehicleSwapService.performVehicleSwap(
      bookingId,
      newVehicleId,
      user.id,
      reason as SwapReason,
      reasonNotes,
      markOriginalForMaintenance === true,
      originalVehicleNotes,
    );

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.SWAPPED,
      entityType: StaffEntityType.VEHICLE,
      entityRef: bookingId,
      description: `Vehicle swapped in booking ${bookingId} — reason: ${reason}`,
      metadata: { newVehicleId, reason, reasonNotes },
    });

    return res.status(StatusCode.OK).json({
      message: "Vehicle swapped successfully",
      data: swap,
    });
  } catch (error: any) {
    console.error("Error performing vehicle swap:", error);

    if (error.message.includes("not found")) {
      return res
        .status(StatusCode.NOT_FOUND)
        .json({ message: error.message });
    }

    if (
      error.message.includes("not eligible") ||
      error.message.includes("not available") ||
      error.message.includes("Cannot swap")
    ) {
      return res
        .status(StatusCode.BAD_REQUEST)
        .json({ message: error.message });
    }

    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message || "Failed to perform vehicle swap",
    });
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
        startAt: true,
        endAt: true,
        frozenChargeConfig: true,
        items: {
          take: 1,
          select: {
            vehicle: {
              select: {
                make: true,
                model: true,
                regNo: true,
                pricingOverride: true,
                branch: {
                  select: {
                    pricingSetting: true,
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

    // Use vehicle custom pricing if available, otherwise fall back to branch defaults
    const pricing = vehicle.pricingOverride ?? vehicle.branch.pricingSetting;

    const rules = {
      vehicle: {
        make: vehicle.make,
        model: vehicle.model,
        regNo: vehicle.regNo,
      },
      pricing: pricing
        ? {
            freeKm24Hour: (pricing as any).freeKm24Hour ?? 0,
            freeKmMonthly: (pricing as any).freeKmMonthly ?? 0,
            extraKmRate: (pricing as any).extraKmRate
              ? new Decimal((pricing as any).extraKmRate.toString()).toFixed(2)
              : "0",
            extraHourRate: (pricing as any).extraHourRate
              ? new Decimal((pricing as any).extraHourRate.toString()).toFixed(2)
              : "0",
            price24Hour: (pricing as any).price24Hour
              ? new Decimal((pricing as any).price24Hour.toString()).toFixed(2)
              : "0",
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
