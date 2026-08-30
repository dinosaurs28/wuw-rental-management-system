import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { verifyCheckoutSignature } from "../../services/payment/razorpay.service.js";
import {
  confirmBookingPayment,
  confirmExtensionPayment,
} from "../../services/payment/bookingConfirmation.service.js";

/**
 * Fast path called by the Razorpay Checkout success handler on web/mobile so
 * the customer is not left polling. The webhook is still the source of truth —
 * both may run, and both are idempotent.
 */
export const verifyPayment = async (req: Request, res: Response) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
    console.log(`[verifyPayment] START orderId=${razorpay_order_id} paymentId=${razorpay_payment_id}`);

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required",
      });
    }

    const signatureValid = verifyCheckoutSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!signatureValid) {
      console.warn(`[verifyPayment] INVALID SIGNATURE orderId=${razorpay_order_id}`);
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Payment signature verification failed",
      });
    }

    const actor = {
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
    };

    const booking = await prisma.booking.findUnique({
      where: { transactionId: razorpay_order_id },
      select: { id: true, publicId: true },
    });

    if (booking) {
      const { alreadyConfirmed, skipped } = await confirmBookingPayment({
        bookingId: booking.id,
        transactionId: razorpay_order_id,
        isCash: false,
        gatewayPaymentId: razorpay_payment_id,
        actor,
      });

      if (skipped === "CANCELLED") {
        console.error(`[verifyPayment] booking=${booking.publicId} was CANCELLED before payment landed — refund required`);
        return res.status(StatusCode.CONFLICT).json({
          status: "Failed",
          message: "This booking expired before the payment completed. Any amount debited will be refunded.",
        });
      }

      console.log(`[verifyPayment] booking=${booking.publicId} confirmed alreadyConfirmed=${alreadyConfirmed}`);
      return res.status(StatusCode.OK).json({
        status: "Success",
        ...(alreadyConfirmed ? { message: "Booking already confirmed" } : {}),
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    const extension = await prisma.bookingExtension.findUnique({
      where: { gatewayTransactionId: razorpay_order_id },
      select: { id: true, publicId: true },
    });

    if (extension) {
      const { alreadyConfirmed, skipped } = await confirmExtensionPayment({
        extensionId: extension.id,
        transactionId: razorpay_order_id,
        gatewayPaymentId: razorpay_payment_id,
        actorName: "Razorpay Checkout",
        actor,
      });

      if (skipped) {
        console.error(`[verifyPayment] extension=${extension.publicId} not confirmable (${skipped}) — refund required`);
        return res.status(StatusCode.CONFLICT).json({
          status: "Failed",
          message:
            skipped === "CANCELLED"
              ? "The booking for this extension was cancelled before the payment completed. Any amount debited will be refunded."
              : "This extension is no longer active. Any amount debited will be refunded.",
        });
      }

      console.log(`[verifyPayment] extension=${extension.publicId} confirmed alreadyConfirmed=${alreadyConfirmed}`);
      return res.status(StatusCode.OK).json({
        status: "Success",
        ...(alreadyConfirmed ? { message: "Extension already confirmed" } : {}),
      });
    }

    // Damage/fine payments park their order id on Payment.razorpayOrderId, not
    // on Booking.transactionId. They are settled by the branch-manager endpoint,
    // which also finalizes the damage report — work this handler deliberately
    // does not replicate. Fail loudly and name the right route rather than
    // returning a bare 404 that looks like an unknown order.
    const finePayment = await prisma.payment.findFirst({
      where: { razorpayOrderId: razorpay_order_id },
      select: { publicId: true },
    });

    if (finePayment) {
      console.warn(
        `[verifyPayment] orderId=${razorpay_order_id} is a damage/fine payment (payment=${finePayment.publicId}) — wrong endpoint`,
      );
      return res.status(StatusCode.CONFLICT).json({
        message:
          "This order belongs to a damage/fine payment; verify it via GET /api/branchManager/payment/status/:transactionId",
      });
    }

    console.warn(`[verifyPayment] NO BOOKING OR EXTENSION for orderId=${razorpay_order_id}`);
    return res.status(StatusCode.NOT_FOUND).json({
      message: "No booking or extension found for this order",
    });
  } catch (error) {
    console.error("[verifyPayment] UNHANDLED ERROR:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while verifying payment",
    });
  }
};
