import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingPhotoType } from "@repo/database/client";

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
 */
export const GetPickupCaptures = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const photos = await prisma.bookingPhoto.findMany({
      where: { bookingId: booking.id, type: BookingPhotoType.PRE_DELIVERY },
      include: { file: { select: { url: true, mime: true } } },
      orderBy: { createdAt: "asc" },
    });

    // Return as array (some may have captureLabel, some may not)
    const result = photos.map((p) => ({
      publicId: p.publicId,
      captureLabel: p.captureLabel ?? null,
      url: p.file.url,
      mime: p.file.mime,
    }));

    return res.status(StatusCode.OK).json({ photos: result });
  } catch (error) {
    console.error("GetPickupCaptures error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
