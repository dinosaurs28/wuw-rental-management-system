import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, SwapReason } from "@repo/database/client";
import {
  VehicleSwapService,
  swapErrorResponse,
} from "../../services/vehicle-swap/vehicle-swap.service.js";
import { vehicleSwapSchema, swapHistoryQuerySchema } from "@repo/schemas";
import { staffActivityService, StaffActionType, StaffEntityType } from "../../services/staffActivity/staffActivity.service.js";

const vehicleSwapService = new VehicleSwapService();

/**
 * Get available vehicles for swap
 * GET /api/branchManager/dashboard/bookings/:bookingId/available-vehicles
 *
 * Same response as the employee endpoint: data = candidates with the
 * price-difference preview, swapContext = stage / readings rule / current car.
 */
export const GetAvailableVehicles = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const { bookingId } = req.params;

  if (!bookingId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Booking ID is required",
    });
  }

  try {
    const { vehicles, excluded, context } =
      await vehicleSwapService.getAvailableVehiclesForSwap(
        bookingId,
        branchId,
      );

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
 * Perform vehicle swap
 * POST /api/branchManager/dashboard/bookings/:bookingId/swap-vehicle
 *
 * A PICKED_UP booking needs all four readings (READINGS_REQUIRED otherwise).
 */
export const SwapVehicle = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  // Validation
  if (!bookingId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Booking ID is required",
    });
  }

  // Validate request body using schema
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
      return res.status(StatusCode.UNAUTHORIZED).json({
        success: false,
        message: "Manager user not found",
      });
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
    // If bookingId is provided, get history for that booking (this branch's only)
    if (bookingId) {
      const history = await vehicleSwapService.getBookingSwapHistory(
        String(bookingId),
        branchId,
      );

      return res.status(StatusCode.OK).json({
        success: true,
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
      success: true,
      message: "Swap history fetched successfully",
      data: history,
      filters: {
        startDate,
        endDate,
        vehicleId: vehicleId || null,
        reason: reason || null,
      },
    });
  } catch (error: unknown) {
    console.error("Error fetching swap history:", error);
    const { status, body } = swapErrorResponse(error, "Failed to fetch swap history");
    return res.status(status).json(body);
  }
};

/**
 * Get booking swap history (newest first)
 * GET /api/branchManager/dashboard/bookings/:bookingId/swap-history
 * :bookingId is the booking publicId (a numeric id is also accepted).
 */
export const GetBookingSwapHistory = async (req: Request, res: Response) => {
  const { bookingId } = req.params;

  if (!bookingId) {
    return res.status(StatusCode.BAD_REQUEST).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "Booking ID is required",
    });
  }

  try {
    const history = await vehicleSwapService.getBookingSwapHistory(
      bookingId,
      req.branch_Id,
    );

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
