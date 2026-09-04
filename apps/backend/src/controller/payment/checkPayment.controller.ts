import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, PaymentStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import {
  fetchOrderStatus,
  isRazorpayOrderId,
  type GatewayPaymentStatus,
} from "../../services/payment/razorpay.service.js";
import {
  confirmBookingPayment,
  failBookingPayment,
} from "../../services/payment/bookingConfirmation.service.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";

export const checkPayment = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;
    console.log(`[checkPayment] START transactionId=${transactionId}`);

    if (!transactionId) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Transaction ID is missing",
      });
    }

    const booking = await prisma.booking.findUnique({
      where: { transactionId },
      include: {
        items: {
          include: { vehicle: true },
        },
      },
    });

    if (!booking) {
      console.log(`[checkPayment] BOOKING NOT FOUND transactionId=${transactionId}`);
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found for this transactionId",
      });
    }

    console.log(`[checkPayment] booking found id=${booking.publicId} status=${booking.status} paymentStatus=${booking.paymentStatus}`);

    // Idempotency check - if already SUCCESS, return OK without calling the gateway
    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      console.log(`[checkPayment] idempotency hit — booking already confirmed bookingId=${booking.publicId}`);
      return res.status(StatusCode.OK).json({
        status: "Success",
        message: "Booking already confirmed",
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    // Determine if this is a Cash transaction
    const isCash = transactionId.startsWith("CASH_");

    let gatewayStatus: GatewayPaymentStatus | null = null;
    if (isRazorpayOrderId(transactionId)) {
      console.log(`[checkPayment] calling Razorpay status API for ${transactionId}`);
      gatewayStatus = await fetchOrderStatus(transactionId);
      console.log(`[checkPayment] Razorpay resolved state=${gatewayStatus?.state ?? "null"}`);

      // null means Razorpay was unreachable — never treat that as a failure.
      if (!gatewayStatus) {
        console.warn(`[checkPayment] fetchOrderStatus returned null for ${transactionId} — treating as Pending`);
        return res.status(StatusCode.OK).json({
          status: "Pending",
          message: "Payment gateway unreachable, please retry",
        });
      }
    }

    const isOnlineSuccess = gatewayStatus?.state === "SUCCESS";
    const isOnlinePending = gatewayStatus?.state === "PENDING";

    console.log(`[checkPayment] isCash=${isCash} isOnlineSuccess=${isOnlineSuccess} isOnlinePending=${isOnlinePending} state=${gatewayStatus?.state}`);

    if (isOnlineSuccess || isCash) {
      const { alreadyConfirmed, skipped } = await confirmBookingPayment({
        bookingId: booking.id,
        transactionId,
        isCash,
        gatewayPaymentId: gatewayStatus?.paymentId ?? null,
        actor: {
          ip: req.ip,
          userAgent: req.headers["user-agent"] as string | undefined,
        },
      });

      // Paid, but the hold had already expired and the booking was cancelled.
      // Reporting Success would promise a car that may now belong to someone else.
      if (skipped === "CANCELLED") {
        console.error(`[checkPayment] booking=${booking.publicId} was CANCELLED before payment landed — refund required`);
        return res.status(StatusCode.OK).json({
          status: "Failed",
          message: "This booking expired before the payment completed. Any amount debited will be refunded.",
          redirectURL: "FRONTEND_FAILED_URL",
        });
      }

      console.log(`[checkPayment] SUCCESS booking=${booking.publicId} alreadyConfirmed=${alreadyConfirmed}`);
      return res.status(StatusCode.OK).json({
        status: "Success",
        ...(alreadyConfirmed ? { message: "Booking already confirmed" } : {}),
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    // Targeted availability cache invalidation (TASK-019)
    try {
      const vehicleIds = booking.items.map((item) => item.vehicle.id);
      await invalidateVehicleAvailability(redis, vehicleIds);
    } catch (redisErr) {
      console.warn("[payment] Cache invalidation failed (non-fatal):", redisErr);
    }

    if (isOnlinePending) {
      console.log(`[checkPayment] PENDING booking=${booking.publicId}`);
      return res.status(StatusCode.OK).json({
        status: "Pending",
        message: "Payment is still pending",
      });
    }

    console.log(`[checkPayment] FAILED booking=${booking.publicId} state=${gatewayStatus?.state} — cancelling`);
    await failBookingPayment(booking.id);

    return res.status(StatusCode.OK).json({
      status: "Failed",
      redirectURL: "FRONTEND_FAILED_URL",
    });
  } catch (error) {
    console.error("[checkPayment] UNHANDLED ERROR:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while checking payment",
    });
  }
};
