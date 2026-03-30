import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";

export const cancelEmployeeHold = async (req: Request, res: Response) => {
  try {
    const { holdId } = req.params;

    if (!holdId) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Hold ID is required" });
    }

    // Find booking by publicId (same pattern as bookingExpiry.worker.ts)
    const booking = await prisma.booking.findUnique({
      where: { publicId: holdId },
      include: {
        items: {
          include: {
            vehicle: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    if (booking.status !== BookingStatus.HOLD) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "This booking hold is no longer active",
      });
    }

    // Update booking status in DB (same pattern as bookingExpiry.worker.ts)
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: BookingStatus.HOLD_EXPIRED,
        holdExpiresAt: null,
      },
    });

    // Clear Redis hold key and vehicle holds (mirror bookingExpiry.worker.ts logic)
    try {
      await redis.del(holdId);

      for (const item of booking.items) {
        const vehicleHoldKey = `vehicle_holds:${item.vehicle.publicId}`;
        await redis.srem(vehicleHoldKey, holdId);
        const remaining = await redis.scard(vehicleHoldKey);
        if (remaining === 0) {
          await redis.del(vehicleHoldKey);
        }
      }

      // Invalidate availability cache for affected vehicles
      const vehicleIds = booking.items.map((item) => item.vehicle.id);
      if (vehicleIds.length > 0) {
        await redis.del(...vehicleIds.map((id) => `vehicle:${id}:availability`));
      }
    } catch (redisErr) {
      console.error("[cancelEmployeeHold] Redis cleanup error (non-fatal):", redisErr);
    }

    return res.status(StatusCode.OK).json({ message: "Booking hold cancelled" });
  } catch (err) {
    console.error("[cancelEmployeeHold] Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
