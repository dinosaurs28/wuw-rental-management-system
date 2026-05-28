import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { paymentStatusCheck } from "../../utils/payment/paymentStatusCheck.utils.js";
import {
  prisma,
  BookingStatus,
  PaymentStatus,
  VehicleStatus,
  DepositMethod,
  InvoiceStatus,
  Role,
  PaymentMethod,
  PaymentPurpose,
} from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { auditService } from "../../services/audit/audit.service.js";
import { AuditCategory } from "@repo/database/client";
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

    let paymentStatus;
    if (transactionId.startsWith("MT")) {
      console.log(`[checkPayment] calling PhonePe status API for ${transactionId}`);
      paymentStatus = await paymentStatusCheck(transactionId);
      console.log(`[checkPayment] PhonePe raw response:`, JSON.stringify(paymentStatus));

      if (!paymentStatus) {
        console.warn(`[checkPayment] paymentStatusCheck returned null/undefined for ${transactionId} — treating as Pending`);
        return res.status(StatusCode.OK).json({
          status: "Pending",
          message: "Payment gateway unreachable, please retry",
        });
      }
    }
    // Determine if this is a Cash transaction
    const isCash = transactionId.startsWith("CASH_");
    const isOnlineSuccess = paymentStatus?.code === "PAYMENT_SUCCESS";
    const isOnlinePending = paymentStatus?.code === "PAYMENT_PENDING";

    console.log(`[checkPayment] isCash=${isCash} isOnlineSuccess=${isOnlineSuccess} isOnlinePending=${isOnlinePending} code=${paymentStatus?.code}`);

    // Idempotency check - if already SUCCESS, return OK
    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      console.log(`[checkPayment] idempotency hit — booking already confirmed bookingId=${booking.publicId}`);
      return res.status(StatusCode.OK).json({
        status: "Success",
        message: "Booking already confirmed",
        redirectURL: "FRONTEND_SUCCESS_URL",
      });
    }

    if (isOnlineSuccess || isCash) {
      // Fetch actor info before the transaction to avoid adding latency inside it
      const paymentActor = await prisma.user.findUnique({
        where: { id: booking.createdById },
        select: { name: true, role: true, branchId: true },
      });

      console.log(`[checkPayment] starting Prisma transaction to confirm booking=${booking.publicId}`);
      await prisma.$transaction(async (tx) => {
        const method = isCash
          ? DepositMethod.CASH
          : DepositMethod.ONLINE_RAZORPAY;

        const bookingUpdateData: any = {
          status: BookingStatus.CONFIRMED,
          paymentStatus: PaymentStatus.SUCCESS,
          holdExpiresAt: null,
          depositMethod: method,
        };

        // For advance payment: record when the advance was paid
        if (booking.isAdvancePayment) {
          bookingUpdateData.advancePaidAt = new Date();
          bookingUpdateData.advancePaymentId = transactionId;
          bookingUpdateData.advancePaymentMode = method;
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
              method: method,
            },
          });
        }

        // For advance payment: invoice stays PENDING until remaining is collected.
        // For full payment: invoice is PAID immediately.
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

        // Payment record reflects the actual amount charged (advance or full)
        const paymentAmount = booking.isAdvancePayment
          ? booking.advanceAmount
          : booking.totalFinal;

        await tx.payment.create({
          data: {
            publicId: createID(),
            invoiceId: invoice.id,
            method: method,
            status: PaymentStatus.SUCCESS,
            amount: paymentAmount,
          },
        });

        // Cash collected by an employee always requires manager approval (COLLECTED)
        // before it is counted as received — regardless of cashConfirmationEnabled.
        // Online payments confirm immediately.
        let activeShiftId: number | null = null;

        if (isCash) {
          const activeShift = await (tx as any).cashShift.findFirst({
            where: { employeeId: booking.createdById, status: "OPEN" },
            select: { id: true },
          });
          activeShiftId = activeShift?.id ?? null;
        }

        const txnStatus = isCash ? "COLLECTED" : "CONFIRMED";
        const now = new Date();

        await tx.paymentTransaction.create({
          data: {
            publicId:            createID(),
            idempotencyKey:      `initial:${transactionId}`,
            bookingId:           booking.id,
            branchId:            booking.branchId,
            purpose:             booking.isAdvancePayment ? PaymentPurpose.ADVANCE : PaymentPurpose.FULL_PAYMENT,
            method:              isCash ? PaymentMethod.CASH : PaymentMethod.ONLINE,
            status:              txnStatus,
            totalAmount:         paymentAmount,
            cashAmount:          isCash ? paymentAmount : 0,
            onlineAmount:        isCash ? 0 : paymentAmount,
            onlineTransactionRef: isCash ? null : transactionId,
            onlineGateway:       isCash ? null : "PHONEPE",
            collectedById:       isCash ? booking.createdById : null,
            collectedAt:         isCash ? now : null,
            confirmedById:       txnStatus === "CONFIRMED" ? booking.createdById : null,
            confirmedAt:         txnStatus === "CONFIRMED" ? now : null,
            cashShiftId:         activeShiftId,
          },
        });

      }, { timeout: 15000 });

      console.log(`[checkPayment] Prisma transaction committed OK for booking=${booking.publicId}`);

      // Clear Redis holds outside the transaction (Redis is not transactional)
      for (const item of booking.items) {
        const vehicleHoldKey = `vehicle_holds:${item.vehicle.publicId}`;
        await redis.srem(vehicleHoldKey, booking.publicId);
        const remaining = await redis.scard(vehicleHoldKey);
        if (remaining === 0) await redis.del(vehicleHoldKey);
        console.log(`[checkPayment] cleared vehicle_holds:${item.vehicle.publicId}`);
      }
      await redis.del(booking.publicId);
      console.log(`[checkPayment] cleared hold:${booking.publicId}`);

      // Audit log outside the transaction to avoid timeout
      await auditService.log({
        actorId: booking.createdById,
        actorName: paymentActor?.name ?? "Unknown",
        actorRole: paymentActor?.role ?? Role.CUSTOMER,
        actorBranchId: paymentActor?.branchId ?? undefined,
        action: booking.isAdvancePayment ? "BOOKING_CONFIRMED_ADVANCE" : "BOOKING_CONFIRMED",
        category: AuditCategory.PAYMENT,
        description: `Booking ${booking.publicId} confirmed via online payment`,
        entity: "Booking",
        entityId: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
        before: { status: BookingStatus.HOLD },
        after: { status: "CONFIRMED", paymentStatus: "SUCCESS", isAdvancePayment: booking.isAdvancePayment },
      });

      console.log(`[checkPayment] SUCCESS booking=${booking.publicId} confirmed`);
      return res.status(StatusCode.OK).json({
        status: "Success",
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

    console.log(`[checkPayment] FAILED booking=${booking.publicId} code=${paymentStatus?.code} — cancelling`);
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: PaymentStatus.FAILED,
        status: BookingStatus.CANCELLED,
      },
    });

    // Clear both the booking hold and all per-vehicle holds so vehicles
    // become immediately bookable again after a failed payment.
    for (const item of booking.items) {
      const vehicleHoldKey = `vehicle_holds:${item.vehicle.publicId}`;
      await redis.srem(vehicleHoldKey, booking.publicId);
      const remaining = await redis.scard(vehicleHoldKey);
      if (remaining === 0) await redis.del(vehicleHoldKey);
    }
    await redis.del(booking.publicId);

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
