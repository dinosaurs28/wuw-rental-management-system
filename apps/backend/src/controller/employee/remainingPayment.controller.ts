import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, DepositMethod, BookingStatus } from "@repo/database/client";
import {
  createRazorpayOrder,
  fetchOrderStatus,
} from "../../services/payment/razorpay.service.js";
import { AdvanceDepositService } from "../../services/booking/advance-deposit.service.js";
import { createID } from "../../utils/nanoID.js";

const advanceDepositService = new AdvanceDepositService();

/**
 * POST /employee/pickup/:bookingId/initiate-remaining-payment
 * POST /employee/return/:bookingId/initiate-remaining-payment
 *
 * body: { method: "CASH" | "UPI" | "ONLINE_RAZORPAY", paidDuring: "PICKUP" | "RETURN" }
 */
export const InitiateRemainingPayment = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { method, paidDuring } = req.body;
  const branchId = req.branch_Id;

  if (!["CASH", "ONLINE_RAZORPAY"].includes(method)) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid payment method. Use CASH, UPI, or ONLINE_RAZORPAY.",
    });
  }

  if (!["PICKUP", "RETURN"].includes(paidDuring)) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid paidDuring value. Use PICKUP or RETURN.",
    });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    if (!booking.isAdvancePayment) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "This booking is not an advance payment booking.",
      });
    }

    if (booking.remainingPaidAt) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Remaining payment has already been collected.",
      });
    }

    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.PICKED_UP
    ) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Cannot collect remaining payment. Booking status is ${booking.status}.`,
      });
    }

    // CASH or UPI: record directly, no payment gateway needed
    if (method === "CASH" || method === "UPI") {
      const depositMethod =
        method === "CASH" ? DepositMethod.CASH : DepositMethod.UPI;
      const transactionId = `CASH_REM_${createID()}`;

      await advanceDepositService.recordRemainingPayment(
        bookingId as string,
        depositMethod,
        transactionId,
        paidDuring as "PICKUP" | "RETURN",
      );

      return res.status(StatusCode.OK).json({
        success: true,
        message: `Remaining payment of ₹${booking.remainingBalance} collected via ${method}.`,
        data: {
          amountCollected: booking.remainingBalance,
          method,
          paidDuring,
        },
      });
    }

    // ONLINE_RAZORPAY: create a Razorpay order for the customer to pay against
    const order = await createRazorpayOrder(Number(booking.remainingBalance), {
      receipt: booking.publicId,
      notes: { purpose: "REMAINING_PAYMENT", booking_id: booking.publicId },
    });

    // Temporarily store the gateway transaction ID on the booking so we can verify later
    await prisma.booking.update({
      where: { id: booking.id },
      data: { remainingPaymentId: order.orderId },
    });

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Payment initiated. Ask the customer to complete the checkout.",
      data: {
        transactionId: order.orderId,
        razorpay: {
          orderId: order.orderId,
          keyId: order.keyId,
          amount: order.amount,
          amountInRupees: order.amountInRupees,
          currency: order.currency,
        },
        amount: booking.remainingBalance,
      },
    });
  } catch (error: any) {
    console.error("InitiateRemainingPayment error:", error);
    if (error.message?.includes("already collected")) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
    }
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};

/**
 * GET /employee/payment/remaining-status/:transactionId
 *
 * Called after the customer completes Razorpay Checkout. Looks up booking by
 * remainingPaymentId, checks payment status, records if successful.
 */
export const CheckRemainingPaymentByTransaction = async (req: Request, res: Response) => {
  const { transactionId } = req.params;
  const branchId = req.branch_Id;

  if (!transactionId) {
    return res.status(StatusCode.BAD_REQUEST).json({ message: "Transaction ID is required." });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: { remainingPaymentId: transactionId, branchId },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found for this transaction." });
    }

    // Derive context once — used in all responses so the frontend can redirect correctly
    const context: "pickup" | "return" =
      booking.status === BookingStatus.CONFIRMED ? "pickup" : "return";
    const bookingPublicId = booking.publicId;

    // Already recorded
    if (booking.remainingPaidAt) {
      return res.status(StatusCode.OK).json({
        status: "SUCCESS",
        message: "Remaining payment already collected.",
        bookingPublicId,
        context,
      });
    }

    const paymentStatus = await fetchOrderStatus(transactionId);

    // Gateway unreachable — unknown, not failed. Keep the pending id and retry.
    if (!paymentStatus) {
      return res.status(StatusCode.OK).json({
        status: "PENDING",
        message: "Could not reach the payment gateway. Please check again shortly.",
        bookingPublicId,
        context,
      });
    }

    if (paymentStatus.state === "SUCCESS") {
      const paidDuring: "PICKUP" | "RETURN" = context === "pickup" ? "PICKUP" : "RETURN";

      await advanceDepositService.recordRemainingPayment(
        bookingPublicId,
        DepositMethod.ONLINE_RAZORPAY,
        transactionId,
        paidDuring,
      );

      return res.status(StatusCode.OK).json({
        status: "SUCCESS",
        message: "Remaining payment confirmed.",
        bookingPublicId,
        context,
      });
    }

    if (paymentStatus.state === "PENDING") {
      return res.status(StatusCode.OK).json({
        status: "PENDING",
        message: "Payment is still pending.",
        bookingPublicId,
        context,
      });
    }

    // Failed — clear the pending transactionId so employee can retry
    await prisma.booking.update({
      where: { id: booking.id },
      data: { remainingPaymentId: null },
    });

    return res.status(StatusCode.OK).json({
      status: "FAILED",
      message: "Payment failed. Please try again.",
      bookingPublicId,
      context,
    });
  } catch (error: any) {
    console.error("CheckRemainingPaymentByTransaction error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

/**
 * GET /employee/pickup/:bookingId/remaining-payment/status
 * GET /employee/return/:bookingId/remaining-payment/status
 *
 * Checks the status of an ONLINE remaining payment and records it on success.
 * query: { paidDuring: "PICKUP" | "RETURN" }
 */
export const CheckRemainingPaymentStatus = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const paidDuring = (req.query.paidDuring as string) || "PICKUP";
  const branchId = req.branch_Id;

  if (!["PICKUP", "RETURN"].includes(paidDuring)) {
    return res.status(StatusCode.BAD_REQUEST).json({
      message: "Invalid paidDuring query param. Use PICKUP or RETURN.",
    });
  }

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    if (!booking.isAdvancePayment) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "This booking is not an advance payment booking.",
      });
    }

    // Already confirmed
    if (booking.remainingPaidAt) {
      return res.status(StatusCode.OK).json({
        status: "SUCCESS",
        message: "Remaining payment already collected.",
        data: {
          paidAt: booking.remainingPaidAt,
          method: booking.remainingPaymentMode,
          paidDuring: booking.remainingPaidDuring,
        },
      });
    }

    if (!booking.remainingPaymentId) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "No pending online remaining payment found. Initiate payment first.",
      });
    }

    // CASH prefix: already recorded (shouldn't reach here, but handle gracefully)
    if (booking.remainingPaymentId.startsWith("CASH_REM_")) {
      return res.status(StatusCode.OK).json({ status: "SUCCESS" });
    }

    // Online: check the Razorpay order status
    const paymentStatus = await fetchOrderStatus(booking.remainingPaymentId);

    // Gateway unreachable — unknown, not failed. Keep the pending id and retry.
    if (!paymentStatus) {
      return res.status(StatusCode.OK).json({
        status: "PENDING",
        message: "Could not reach the payment gateway. Please check again shortly.",
      });
    }

    if (paymentStatus.state === "SUCCESS") {
      await advanceDepositService.recordRemainingPayment(
        bookingId as string,
        DepositMethod.ONLINE_RAZORPAY,
        booking.remainingPaymentId,
        paidDuring as "PICKUP" | "RETURN",
      );

      return res.status(StatusCode.OK).json({
        status: "SUCCESS",
        message: `Remaining payment confirmed.`,
        data: {
          amount: booking.remainingBalance,
          paidDuring,
        },
      });
    }

    if (paymentStatus.state === "PENDING") {
      return res.status(StatusCode.OK).json({
        status: "PENDING",
        message: "Payment is still pending. Ask customer to complete payment.",
      });
    }

    // Failed: clear the pending transactionId so employee can retry
    await prisma.booking.update({
      where: { id: booking.id },
      data: { remainingPaymentId: null },
    });

    return res.status(StatusCode.OK).json({
      status: "FAILED",
      message: "Payment failed. Please try again.",
    });
  } catch (error: any) {
    console.error("CheckRemainingPaymentStatus error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal Server Error",
    });
  }
};
