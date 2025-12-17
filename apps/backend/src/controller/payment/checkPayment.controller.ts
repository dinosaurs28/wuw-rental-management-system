import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode";
import { paymentStatusCheck } from "../../utils/payment/paymentStatusCheck.utils";
import { prisma, BookingStatus, PaymentStatus, VehicleStatus, DepositMethod, InvoiceStatus } from "@repo/database/client";
import { redis } from "../../lib/redisconfig";
import { createID } from "../../utils/nanoID";

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
    const paymentStatus = await paymentStatusCheck(transactionId);

    if (!paymentStatus) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Error while checking payment status",
      });
    }
    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      return res.status(StatusCode.OK).json({
        status: "Success",
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    if (paymentStatus.code === "PAYMENT_SUCCESS") {
      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            paymentStatus: PaymentStatus.SUCCESS,
            holdExpiresAt: null,
            depositMethod: DepositMethod.ONLINE_RAZORPAY,
          },
        });

        await tx.vehicle.updateMany({
          where: {
            id: { in: booking.items.map(i => i.vehicleId) },
          },
          data: {
            status: VehicleStatus.OUT_FOR_RENTAL,
          },
        });

        if (booking.totalDeposit.gt(0)) {
          await tx.deposit.create({
            data: {
              publicId: createID(),
              bookingId: booking.id,
              amount: booking.totalDeposit,
              method: DepositMethod.ONLINE_RAZORPAY,
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
            method: DepositMethod.ONLINE_RAZORPAY,
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
    if (paymentStatus.code === "PAYMENT_PENDING") {
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
