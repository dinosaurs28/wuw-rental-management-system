import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, PaymentStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { discountApplicationService } from "../../services/discount/discount-application.service.js";
import { reconcileBookingUpiQrs } from "../../services/payment/upi-qr.service.js";
import { reconcileBookingRazorpayOrder } from "../../services/payment/razorpay-reconcile.service.js";

export const cancelHold = async (req: Request, res: Response) => {
  try {
    const { holdId } = req.params;
    const userPublicId = req.public_Id;

    if (!holdId) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Hold ID is required" });
    }

    // Find booking by publicId (same pattern as bookingExpiry.worker.ts)
    const booking = await prisma.booking.findUnique({
      where: { publicId: holdId },
      include: {
        customer: {
          include: {
            user: {
              select: { publicId: true },
            },
          },
        },
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

    // Verify the customer owns this booking
    if (booking.customer.user.publicId !== userPublicId) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Access denied" });
    }

    if (booking.status !== BookingStatus.HOLD) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "This booking hold is no longer active",
      });
    }

    // Close any open UPI QR first — and keep the booking if one already paid it (#2)
    if (await reconcileBookingUpiQrs(booking.id, { close: "CLOSED" })) {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "UPI_QR_ALREADY_PAID",
        message: "This booking was already paid by UPI QR and is confirmed.",
      });
    }

    // The app releases the hold whenever Razorpay Checkout closes without a
    // success callback — which also happens after a UPI payment went through
    // (UPI app returned late / "cancelled"). Ask Razorpay first: a captured
    // payment confirms the booking instead. Same 409 code as the UPI QR case,
    // so every shipped web / app build already routes it to the success screen.
    const rzp = await reconcileBookingRazorpayOrder(booking.id, {
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    });
    if (rzp === "CONFIRMED" || rzp === "ALREADY_CONFIRMED") {
      return res.status(StatusCode.CONFLICT).json({
        success: false,
        code: "UPI_QR_ALREADY_PAID",
        paidBy: "CHECKOUT",
        message: "Your payment was received and this booking is confirmed.",
      });
    }

    // Update booking status in DB (same pattern as bookingExpiry.worker.ts) and
    // give the hold's coupon use back in the same transaction
    // Guarded: a webhook / poll / sweep may confirm it between the check above
    // and here — never flip a paid booking back to HOLD_EXPIRED
    const released = await prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: BookingStatus.HOLD, paymentStatus: { not: PaymentStatus.SUCCESS } },
        data: {
          status: BookingStatus.HOLD_EXPIRED,
          holdExpiresAt: null,
        },
      });
      if (count === 0) return false;
      await discountApplicationService.releaseUsage(booking.id, tx);
      return true;
    });
    if (!released) {
      const latest = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { paymentStatus: true },
      });
      if (latest?.paymentStatus === PaymentStatus.SUCCESS) {
        return res.status(StatusCode.CONFLICT).json({
          success: false,
          code: "UPI_QR_ALREADY_PAID",
          paidBy: "CHECKOUT",
          message: "Your payment was received and this booking is confirmed.",
        });
      }
      return res.status(StatusCode.BAD_REQUEST).json({ message: "This booking hold is no longer active" });
    }

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
      console.error("[cancelHold] Redis cleanup error (non-fatal):", redisErr);
    }

    return res.status(StatusCode.OK).json({ message: "Booking hold cancelled" });
  } catch (err) {
    console.error("[cancelHold] Error:", err);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
