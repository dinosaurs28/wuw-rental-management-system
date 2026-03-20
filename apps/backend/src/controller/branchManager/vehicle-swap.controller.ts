import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, SwapReason } from "@repo/database/client";
import { VehicleSwapService } from "../../services/vehicle-swap/vehicle-swap.service.js";
import { vehicleSwapSchema, swapHistoryQuerySchema } from "@repo/schemas";

const vehicleSwapService = new VehicleSwapService();

/**
 * Get available vehicles for swap
 * GET /api/branchManager/bookings/:bookingId/available-vehicles
 */
export const GetAvailableVehicles = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const { bookingId } = req.params;

  if (!bookingId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Booking ID is required",
    });
  }

  try {
    const availableVehicles =
      await vehicleSwapService.getAvailableVehiclesForSwap(
        bookingId,
        branchId,
      );

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
 * Perform vehicle swap
 * POST /api/branchManager/bookings/:bookingId/swap-vehicle
 */
export const SwapVehicle = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  // Validation
  if (!bookingId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Booking ID is required",
    });
  }

  // Validate request body using schema
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
    const userId = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true },
    });
    const swap = await vehicleSwapService.performVehicleSwap(
      bookingId,
      newVehicleId,
      userId?.id!,
      reason as SwapReason,
      reasonNotes,
      markOriginalForMaintenance === true,
      originalVehicleNotes,
    );

    return res.status(StatusCode.OK).json({
      message: "Vehicle swapped successfully",
      data: swap,
    });
  } catch (error: any) {
    console.error("Error performing vehicle swap:", error);

    // Handle specific error cases
    if (error.message.includes("not found")) {
      return res.status(StatusCode.NOT_FOUND).json({
        message: error.message,
      });
    }

    if (
      error.message.includes("not eligible") ||
      error.message.includes("not available") ||
      error.message.includes("Cannot swap")
    ) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: error.message,
      });
    }

    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message || "Failed to perform vehicle swap",
    });
  }
};

/**
 * Get swap history
 * GET /api/branchManager/swap-history
 * Query params: bookingId, startDate, endDate, vehicleId, reason
 */
export const GetSwapHistory = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;

  // Validate query parameters
  const validation = swapHistoryQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Validation failed",
      errors: validation.error.errors.map((err:any) => ({
        field: err.path.join("."),
        message: err.message,
      })),
    });
  }

  const { bookingId, startDate, endDate, vehicleId, reason } = validation.data;

  try {
    // If bookingId is provided, get history for that booking
    if (bookingId) {
      const history = await vehicleSwapService.getSwapHistory(bookingId);

      return res.status(StatusCode.OK).json({
        message: "Swap history fetched successfully",
        data: history,
      });
    }

    // Otherwise, get by date range (startDate and endDate are guaranteed by schema)
    const filters: any = {};

    if (vehicleId) {
      filters.vehicleId = vehicleId;
    }

    if (reason) {
      filters.reason = reason;
    }

    const history = await vehicleSwapService.getSwapsByDateRange(
      branchId,
      new Date(startDate!),
      new Date(endDate!),
      filters,
    );

    return res.status(StatusCode.OK).json({
      message: "Swap history fetched successfully",
      data: history,
      filters: {
        startDate,
        endDate,
        vehicleId: vehicleId || null,
        reason: reason || null,
      },
    });
  } catch (error: any) {
    console.error("Error fetching swap history:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message || "Failed to fetch swap history",
    });
  }
};

/**
 * Get booking swap history
 * GET /api/branchManager/bookings/:bookingId/swap-history
 */
export const GetBookingSwapHistory = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Booking ID is required",
    });
  }

  try {
    const history = await vehicleSwapService.getSwapHistory(
      parseInt(bookingId),
    );

    return res.status(StatusCode.OK).json({
      message: "Booking swap history fetched successfully",
      data: history,
    });
  } catch (error: any) {
    console.error("Error fetching booking swap history:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: error.message || "Failed to fetch booking swap history",
    });
  }
};
