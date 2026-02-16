import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { paymentStatusCheck } from "../../utils/payment/paymentStatusCheck.utils.js";
import { prisma, BookingStatus, PaymentStatus, VehicleStatus, DepositMethod, InvoiceStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";

export const checkPayment = async (req: Request, res: Response) => {
  try {
    const { transactionId } = req.params;

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
      return res.status(StatusCode.NOT_FOUND).json({
        message: "Booking not found for this transactionId",
      });
    }
    let paymentStatus;
    if (transactionId.startsWith("MT")) {
      paymentStatus = await paymentStatusCheck(transactionId);

      if (!paymentStatus) {
        return res.status(StatusCode.BAD_REQUEST).json({
          message: "Error while checking payment status",
        });
      }
    }
    // Determine if this is a Cash transaction
    const isCash = transactionId.startsWith("CASH_");
    const isOnlineSuccess = paymentStatus?.code === "PAYMENT_SUCCESS";
    const isOnlinePending = paymentStatus?.code === "PAYMENT_PENDING";

    // Idempotency check - if already SUCCESS, return OK
    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      return res.status(StatusCode.OK).json({
        status: "Success",
        message: "Booking already confirmed",
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    if (isOnlineSuccess || isCash) {
      await prisma.$transaction(async (tx) => {
        const method = isCash ? DepositMethod.CASH : DepositMethod.ONLINE_RAZORPAY;

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            paymentStatus: PaymentStatus.SUCCESS,
            holdExpiresAt: null,
            depositMethod: method,
          },
        });

        await tx.vehicle.updateMany({
          where: {
            id: { in: booking.items.map(i => i.vehicleId) },
          },
          data: {
            status: VehicleStatus.AVAILABLE,
          },
        });

        if (booking.totalDeposit.gt(0)) {
          await tx.deposit.create({
            data: {
              publicId: createID(),
              bookingId: booking.id,
              amount: booking.totalDeposit,
              method: method,
            },
          });
        }

        const invoice = await tx.invoice.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            subtotal: booking.totalBase,
            discount: booking.totalDiscount,
            tax: 0,
            damageCharges: 0,
            total: booking.totalFinal,
            status: InvoiceStatus.PAID,
          },
        });

        await tx.invoiceItem.createMany({
          data: booking.items.map(item => ({
            publicId: createID(),
            invoiceId: invoice.id,
            label: `${item.vehicle.make} ${item.vehicle.model}`,
            amount: item.finalTotal,
          })),
        });

        await tx.payment.create({
          data: {
            publicId: createID(),
            invoiceId: invoice.id,
            method: method,
            status: PaymentStatus.SUCCESS,
            amount: booking.totalFinal,
          },
        });

        for (const item of booking.items) {
          await redis.del(`vehicle_holds:${item.vehicle.publicId}`);
        }
        await redis.del(`hold:${booking.publicId}`);

        await tx.auditLog.create({
          data: {
            publicId: createID(),
            userId: booking.createdById,
            action: "BOOKING_CONFIRMED",
            entity: "Booking",
            entityId: booking.publicId,
            after: {
              status: "CONFIRMED",
              paymentStatus: "SUCCESS",
            },
          },
        });
      });

      return res.status(StatusCode.OK).json({
        status: "Success",
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    // Invalidate vehicle cache
    let cursor = "0";
    do {
      const reply = await redis.scan(cursor, "MATCH", "public:vehicles:*", "COUNT", 100);
      cursor = reply[0];
      const keys = reply[1];
      if (keys.length > 0) {
        await redis.del(keys);
      }
    } while (cursor !== "0");


    if (isOnlinePending) {
      return res.status(StatusCode.OK).json({
        status: "Pending",
        message: "Payment is still pending",
      });
    }

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: PaymentStatus.FAILED,
        status: BookingStatus.CANCELLED,
      },
    });

    await redis.del(`hold:${booking.publicId}`);

    return res.status(StatusCode.OK).json({
      status: "Failed",
      redirectURL: "FRONTEND_FAILED_URL",
    });

  } catch (error) {
    console.error("Error checking payment:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while checking payment",
    });
  }
};
