import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import {
  prisma,
  BookingStatus,
  PaymentStatus,
  VehicleStatus,
  DepositMethod,
  InvoiceStatus,
  Role,
} from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import jwt from "jsonwebtoken";
import { auditService } from "../../services/audit/audit.service.js";
import { AuditCategory } from "@repo/database/client";

interface CashPaymentPayload {
  finalPrice: number;
}

export const checkPaymentForCash = async (req: Request, res: Response) => {
  try {
    const { encryptedFinalPrice, transactionId } = req.body;

    if (!encryptedFinalPrice) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Encrypted final price is missing",
      });
    }

    if (!transactionId) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Transaction ID is missing",
      });
    }

    // Verify the JWT token
    let decodedPayload: CashPaymentPayload;
    try {
      decodedPayload = jwt.verify(
        encryptedFinalPrice,
        process.env.JWT_SECERT!,
      ) as CashPaymentPayload;
    } catch (jwtError) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Price was tampered. Please retry booking again.",
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

    // Verify the price matches the expected charge amount
    // For advance payments the JWT encodes the advance amount, not the full total
    const expectedAmount = booking.isAdvancePayment
      ? booking.advanceAmount?.toNumber() ?? booking.totalFinal.toNumber()
      : booking.totalFinal.toNumber();

    if (decodedPayload.finalPrice !== expectedAmount) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Price was tampered. Please retry booking again.",
      });
    }

    // Check if booking is already confirmed
    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      return res.status(StatusCode.OK).json({
        status: "Success",
        message: "Booking already confirmed",
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    await prisma.$transaction(async (tx) => {
      const bookingUpdateData: any = {
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.SUCCESS,
        holdExpiresAt: null,
        depositMethod: DepositMethod.CASH,
      };

      if (booking.isAdvancePayment) {
        bookingUpdateData.advancePaidAt = new Date();
        bookingUpdateData.advancePaymentId = transactionId;
        bookingUpdateData.advancePaymentMode = DepositMethod.CASH;
      }

      await tx.booking.update({
        where: { id: booking.id },
        data: bookingUpdateData,
      });

      await tx.vehicle.updateMany({
        where: {
          id: { in: booking.items.map((i) => i.vehicleId) },
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
            method: DepositMethod.CASH,
          },
        });
      }

      // Advance payments: invoice stays PENDING until remaining is collected
      const invoiceStatus = booking.isAdvancePayment
        ? InvoiceStatus.PENDING
        : InvoiceStatus.PAID;

      const invoice = await tx.invoice.create({
        data: {
          publicId: createID(),
          bookingId: booking.id,
          subtotal: booking.totalBase,
          discount: booking.totalDiscount,
          tax: 0,
          damageCharges: 0,
          total: booking.totalFinal,
          status: invoiceStatus,
        },
      });

      await tx.invoiceItem.createMany({
        data: booking.items.map((item) => ({
          publicId: createID(),
          invoiceId: invoice.id,
          label: `${item.vehicle.make} ${item.vehicle.model}`,
          amount: item.finalTotal,
        })),
      });

      // Payment record reflects actual amount charged (advance or full)
      const paymentAmount = booking.isAdvancePayment
        ? booking.advanceAmount
        : booking.totalFinal;

      await tx.payment.create({
        data: {
          publicId: createID(),
          invoiceId: invoice.id,
          method: DepositMethod.CASH,
          status: PaymentStatus.SUCCESS,
          amount: paymentAmount,
        },
      });

      // Clear Redis holds
      for (const item of booking.items) {
        await redis.del(`vehicle_holds:${item.vehicle.publicId}`);
      }
      await redis.del(`hold:${booking.publicId}`);

      const cashActor = await tx.user.findUnique({ where: { id: booking.createdById }, select: { name: true, role: true, branchId: true } });
      await auditService.log({
        actorId: booking.createdById,
        actorName: cashActor?.name ?? "Unknown",
        actorRole: cashActor?.role ?? Role.CUSTOMER,
        actorBranchId: cashActor?.branchId ?? undefined,
        action: booking.isAdvancePayment ? "BOOKING_CONFIRMED_ADVANCE" : "BOOKING_CONFIRMED",
        category: AuditCategory.PAYMENT,
        description: `Booking ${booking.publicId} confirmed via cash payment`,
        entity: "Booking",
        entityId: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
        before: { status: BookingStatus.HOLD },
        after: { status: "CONFIRMED", paymentStatus: "SUCCESS", paymentMethod: "CASH", isAdvancePayment: booking.isAdvancePayment },
      }, tx);
    });

    return res.status(StatusCode.OK).json({
      status: "Success",
      message: "Cash payment confirmed successfully",
      redirectURL: "FRONTEND_SUCCESS_URL",
    });
  } catch (error) {
    console.error("Error checking cash payment:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({
      message: "Internal error while processing cash payment",
    });
  }
};
