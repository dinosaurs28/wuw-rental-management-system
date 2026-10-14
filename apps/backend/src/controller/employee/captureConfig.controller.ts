import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { getReturnConditionPhotos } from "../../services/vehicle-swap/return-condition-photos.service.js";

/**
 * GET /employee/pickup/:bookingId/capture-config
 * Returns the capture config for the booking's vehicle category, or null if none configured.
 */
export const GetPickupCaptureConfig = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
      include: {
        items: {
          include: { vehicle: { include: { category: true } } },
          take: 1,
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const categoryId = booking.items[0]?.vehicle?.categoryId;
    if (!categoryId) {
      return res.status(StatusCode.OK).json({ config: null });
    }

    const config = await prisma.vehiclePhotoCaptureConfig.findUnique({
      where: { branchId_categoryId: { branchId, categoryId } },
      include: { category: { select: { publicId: true, name: true } } },
    });

    return res.status(StatusCode.OK).json({ config: config ?? null });
  } catch (error) {
    console.error("GetPickupCaptureConfig error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

/**
 * GET /employee/return/:bookingId/pickup-captures
 * Returns all PRE_DELIVERY photos for the booking, keyed by captureLabel.
 * Used on the return page to show pre-delivery reference photos.
 *
 * `photos` stays the pickup photos (older app builds show them as before).
 * Additive (client item 2): `currentVehicleCaptures` = the handover photos of
 * the car actually being returned (after a mid-rental swap, the replacement's
 * photos taken at the last swap), `earlierCaptures` = the swapped-out cars'
 * sets (original pickup last), `swapped`, `photosMissing`.
 */
export const GetPickupCaptures = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
      select: { id: true },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const result = await getReturnConditionPhotos(booking.id);

    return res.status(StatusCode.OK).json(result);
  } catch (error) {
    console.error("GetPickupCaptures error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
