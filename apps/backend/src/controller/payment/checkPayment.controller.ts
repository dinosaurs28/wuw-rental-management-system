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
import { CounterGuardError } from "../../services/payment/counter-guard.service.js";
import { bookingUpiQrState } from "../../services/payment/upi-qr.service.js";

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

    // Counter payments (cash, or UPI with a UTR) settle without a gateway call
    const isCash = transactionId.startsWith("CASH_");
    const isUpi = transactionId.startsWith("UPI_");
    // Counter split (cash + UPI) and credit (#11) settle without a gateway too
    const isSplit = transactionId.startsWith("SPLIT_");
    const isCredit = transactionId.startsWith("CREDIT_");

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

    console.log(`[checkPayment] isCash=${isCash} isUpi=${isUpi} isOnlineSuccess=${isOnlineSuccess} isOnlinePending=${isOnlinePending} state=${gatewayStatus?.state}`);

    if (isOnlineSuccess || isCash || isUpi || isSplit || isCredit) {
      const { alreadyConfirmed, skipped } = await confirmBookingPayment({
        bookingId: booking.id,
        transactionId,
        isCash,
        isUpi,
        isSplit,
        isCredit,
        gatewayPaymentId: gatewayStatus?.paymentId ?? null,
        actor: {
          ip: req.ip,
          userAgent: req.headers["user-agent"] as string | undefined,
        },
      });

      // Paid, but the hold had already expired and the booking was cancelled.
      // Reporting Success would promise a car that may now belong to someone else.
      if (skipped === "CANCELLED") {
        // Counter UPI: the money is already in the branch account and the UTR
        // was never claimed, so staff simply book again with it.
        if (isUpi || isSplit) {
          console.warn(`[checkPayment] counter UPI booking=${booking.publicId} is ${booking.status} — staff to re-create it`);
          return res.status(StatusCode.OK).json({
            status: "Failed",
            message: "This booking's hold expired before it was confirmed. The UPI payment was received at the counter — create the booking again with the same payment photo (or UTR).",
            redirectURL: "FRONTEND_FAILED_URL",
          });
        }
        if (isCredit) {
          return res.status(StatusCode.OK).json({
            status: "Failed",
            message: "This booking's hold expired before it was confirmed. Nothing was charged — create the booking again.",
            redirectURL: "FRONTEND_FAILED_URL",
          });
        }
        console.error(`[checkPayment] booking=${booking.publicId} was CANCELLED before payment landed — refund required`);
        return res.status(StatusCode.OK).json({
          status: "Failed",
          message: "This booking expired before the payment completed. Any amount debited will be refunded.",
          redirectURL: "FRONTEND_FAILED_URL",
        });
      }

      // The payment photo (or, from older builds, the UTR) now backs another
      // payment, so this hold can never be confirmed — release the vehicles and
      // let staff re-create it with the right photo / UTR.
      if (skipped === "DUPLICATE_UTR" || skipped === "DUPLICATE_PAYMENT_PROOF") {
        await failBookingPayment(booking.id);
        try {
          await invalidateVehicleAvailability(redis, booking.items.map((item) => item.vehicle.id));
        } catch (redisErr) {
          console.warn("[payment] Cache invalidation failed (non-fatal):", redisErr);
        }
        return res.status(StatusCode.CONFLICT).json(
          skipped === "DUPLICATE_PAYMENT_PROOF"
            ? {
                success: false,
                status: "Failed",
                code: "DUPLICATE_PAYMENT_PROOF",
                message:
                  "This payment photo is already attached to another payment. Create the booking again with a photo of this payment's success screen.",
              }
            : {
                success: false,
                status: "Failed",
                code: "DUPLICATE_UTR",
                message: "This UTR has already been used for another payment. Create the booking again with the correct UTR.",
              },
        );
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

    // The customer may be paying by UPI QR (scanned from another phone) instead
    // of this order: a paid QR confirms the hold, an open one keeps it pending (#2)
    if (isRazorpayOrderId(transactionId)) {
      const qr = await bookingUpiQrState(booking.id, {
        ip: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      });
      if (qr === "CONFIRMED") {
        console.log(`[checkPayment] booking=${booking.publicId} confirmed by UPI QR`);
        return res.status(StatusCode.OK).json({
          status: "Success",
          message: "Payment received by UPI QR",
          redirectURL: "FRONTEND_SUCCESS_URL",
        });
      }
      if (qr === "OPEN") {
        return res.status(StatusCode.OK).json({
          status: "Pending",
          message: "Waiting for the UPI QR payment",
        });
      }
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
    if (error instanceof CounterGuardError) {
      return res.status(error.status).json(error.toJSON());
    }
    console.error("[checkPayment] UNHANDLED ERROR:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while checking payment",
    });
  }
};
