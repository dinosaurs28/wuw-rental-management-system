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
  PaymentMethod,
  PaymentPurpose,
  Role,
  AuditCategory,
} from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { auditService } from "../../services/audit/audit.service.js";
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";
import { invalidateVehicleAvailability } from "../../utils/cache/vehicleCacheKeys.js";

const RECHECKABLE_STATUSES: BookingStatus[] = [BookingStatus.HOLD];

function isRecheckable(status: BookingStatus): boolean {
  return RECHECKABLE_STATUSES.includes(status);
}

export const ListPendingPaymentBookings = async (req: Request, res: Response) => {
  const branchId = req.branch_Id;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  try {
    const [total, bookings] = await Promise.all([
      prisma.booking.count({
        where: {
          branchId,
          status: BookingStatus.HOLD,
          paymentStatus: PaymentStatus.CREATED,
          transactionId: { startsWith: "MT" },
        },
      }),
      prisma.booking.findMany({
        where: {
          branchId,
          status: BookingStatus.HOLD,
          paymentStatus: PaymentStatus.CREATED,
          transactionId: { startsWith: "MT" },
        },
        select: {
          publicId: true,
          transactionId: true,
          totalFinal: true,
          isAdvancePayment: true,
          advanceAmount: true,
          startAt: true,
          endAt: true,
          createdAt: true,
          holdExpiresAt: true,
          customer: {
            select: {
              user: { select: { name: true, phone: true } },
            },
          },
          items: {
            select: {
              vehicle: {
                select: { make: true, model: true, regNo: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
    ]);

    return res.status(StatusCode.OK).json({
      success: true,
      data: bookings,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[ListPendingPaymentBookings] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const GetRecheckInfo = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
      select: {
        publicId: true,
        status: true,
        paymentStatus: true,
        transactionId: true,
        totalFinal: true,
        totalDeposit: true,
        isAdvancePayment: true,
        advanceAmount: true,
        remainingBalance: true,
        startAt: true,
        endAt: true,
        createdAt: true,
        holdExpiresAt: true,
        customer: {
          select: {
            publicId: true,
            user: {
              select: { name: true, email: true, phone: true },
            },
          },
        },
        items: {
          select: {
            vehicle: {
              select: {
                make: true,
                model: true,
                regNo: true,
                images: {
                  where: { isThumbnail: true },
                  take: 1,
                  select: { file: { select: { url: true } } },
                },
              },
            },
          },
        },
        paymentTransactions: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            publicId: true,
            status: true,
            method: true,
            purpose: true,
            totalAmount: true,
            onlineTransactionRef: true,
            onlineGateway: true,
            createdAt: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const recheckable =
      isRecheckable(booking.status) &&
      booking.paymentStatus === PaymentStatus.CREATED &&
      booking.transactionId?.startsWith("MT");

    return res.status(StatusCode.OK).json({
      success: true,
      data: { ...booking, isRecheckable: recheckable },
    });
  } catch (error) {
    console.error("[GetRecheckInfo] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const RecheckPaymentWithGateway = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const branchId = req.branch_Id;
  const managerId = req.public_Id as string;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
      include: { items: { include: { vehicle: true } } },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    if (!isRecheckable(booking.status)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Booking is not in a recheckable state (current: ${booking.status})`,
      });
    }

    if (!booking.transactionId?.startsWith("MT")) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Only online PhonePe transactions can be rechecked via gateway",
      });
    }

    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      return res.status(StatusCode.OK).json({
        gatewayResult: "ALREADY_SUCCESS",
        message: "Payment already confirmed. Booking may need a status correction.",
      });
    }

    const paymentStatus = await paymentStatusCheck(booking.transactionId);

    if (!paymentStatus) {
      return res.status(StatusCode.OK).json({
        gatewayResult: "GATEWAY_UNREACHABLE",
        message: "Payment gateway did not respond. Try again shortly.",
      });
    }

    const isSuccess = paymentStatus.code === "PAYMENT_SUCCESS";
    const isPending = paymentStatus.code === "PAYMENT_PENDING";

    if (isSuccess) {
      const manager = await prisma.user.findFirst({
        where: { publicId: managerId },
        select: { id: true, name: true, role: true, branchId: true },
      });

      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: booking.id },
          data: {
            status: BookingStatus.CONFIRMED,
            paymentStatus: PaymentStatus.SUCCESS,
            holdExpiresAt: null,
            depositMethod: DepositMethod.ONLINE_RAZORPAY,
            ...(booking.isAdvancePayment && {
              advancePaidAt: new Date(),
              advancePaymentId: booking.transactionId,
              advancePaymentMode: DepositMethod.ONLINE_RAZORPAY,
            }),
          },
        });

        await tx.vehicle.updateMany({
          where: { id: { in: booking.items.map((i) => i.vehicleId) } },
          data: { status: VehicleStatus.AVAILABLE },
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
            status: booking.isAdvancePayment ? InvoiceStatus.PENDING : InvoiceStatus.PAID,
          },
        });

        const paymentAmount = booking.isAdvancePayment ? booking.advanceAmount : booking.totalFinal;

        await tx.payment.create({
          data: {
            publicId: createID(),
            invoiceId: invoice.id,
            method: DepositMethod.ONLINE_RAZORPAY,
            status: PaymentStatus.SUCCESS,
            amount: paymentAmount,
          },
        });

        await tx.paymentTransaction.create({
          data: {
            publicId: createID(),
            idempotencyKey: `recheck:gateway:${booking.transactionId}`,
            bookingId: booking.id,
            branchId: booking.branchId,
            purpose: booking.isAdvancePayment ? PaymentPurpose.ADVANCE : PaymentPurpose.FULL_PAYMENT,
            method: PaymentMethod.ONLINE,
            status: "CONFIRMED",
            totalAmount: paymentAmount,
            cashAmount: 0,
            onlineAmount: paymentAmount,
            onlineTransactionRef: booking.transactionId,
            onlineGateway: "PHONEPE",
            confirmedById: manager?.id ?? null,
            confirmedAt: new Date(),
          },
        });

        await staffActivityService.logFromRequest(req, {
          actionType: StaffActionType.CONFIRMED,
          entityType: StaffEntityType.PAYMENT,
          entityRef: booking.publicId,
          description: `Gateway recheck confirmed payment for booking ${booking.publicId}`,
          metadata: { transactionId: booking.transactionId, gatewayCode: paymentStatus.code },
        }, tx);
      });

      for (const item of booking.items) {
        const key = `vehicle_holds:${item.vehicle.publicId}`;
        await redis.srem(key, booking.publicId);
        const remaining = await redis.scard(key);
        if (remaining === 0) await redis.del(key);
      }
      await redis.del(booking.publicId);

      await auditService.log({
        actorId: manager?.id ?? booking.createdById,
        actorName: manager?.name ?? "Manager",
        actorRole: manager?.role ?? Role.MANAGER,
        actorBranchId: branchId,
        action: "PAYMENT_RECHECK_GATEWAY_CONFIRMED",
        category: AuditCategory.PAYMENT,
        description: `Manager triggered gateway recheck — booking ${booking.publicId} confirmed`,
        entity: "Booking",
        entityId: booking.publicId,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
        before: { status: BookingStatus.HOLD, paymentStatus: PaymentStatus.CREATED },
        after: { status: BookingStatus.CONFIRMED, paymentStatus: PaymentStatus.SUCCESS },
      });

      return res.status(StatusCode.OK).json({
        gatewayResult: "SUCCESS",
        message: "Payment confirmed by gateway. Booking is now CONFIRMED.",
        newStatus: BookingStatus.CONFIRMED,
      });
    }

    if (isPending) {
      return res.status(StatusCode.OK).json({
        gatewayResult: "PENDING",
        message: "Payment is still pending on the gateway. You may manually confirm if the customer has bank proof.",
        gatewayCode: paymentStatus.code,
      });
    }

    return res.status(StatusCode.OK).json({
      gatewayResult: "FAILED",
      message: `Gateway returned: ${paymentStatus.code}. Payment has not been received.`,
      gatewayCode: paymentStatus.code,
    });
  } catch (error) {
    console.error("[RecheckPaymentWithGateway] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};

export const ManualConfirmPayment = async (req: Request, res: Response) => {
  const { bookingId } = req.params;
  const { managerNote } = req.body;
  const branchId = req.branch_Id;
  const managerId = req.public_Id as string;

  try {
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingId, branchId },
      include: { items: { include: { vehicle: true } } },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    if (!isRecheckable(booking.status)) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: `Booking is not in a recheckable state (current: ${booking.status})`,
      });
    }

    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Payment is already marked as successful",
      });
    }

    const manager = await prisma.user.findFirst({
      where: { publicId: managerId },
      select: { id: true, name: true, role: true, branchId: true },
    });

    if (!manager) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Manager not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CONFIRMED,
          paymentStatus: PaymentStatus.SUCCESS,
          holdExpiresAt: null,
          depositMethod: DepositMethod.ONLINE_RAZORPAY,
          ...(booking.isAdvancePayment && {
            advancePaidAt: new Date(),
            advancePaymentMode: DepositMethod.ONLINE_RAZORPAY,
          }),
        },
      });

      await tx.vehicle.updateMany({
        where: { id: { in: booking.items.map((i) => i.vehicleId) } },
        data: { status: VehicleStatus.AVAILABLE },
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
          status: booking.isAdvancePayment ? InvoiceStatus.PENDING : InvoiceStatus.PAID,
        },
      });

      const paymentAmount = booking.isAdvancePayment ? booking.advanceAmount : booking.totalFinal;

      await tx.payment.create({
        data: {
          publicId: createID(),
          invoiceId: invoice.id,
          method: DepositMethod.ONLINE_RAZORPAY,
          status: PaymentStatus.SUCCESS,
          amount: paymentAmount,
        },
      });

      await tx.paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `recheck:manual:${booking.publicId}:${Date.now()}`,
          bookingId: booking.id,
          branchId: booking.branchId,
          purpose: booking.isAdvancePayment ? PaymentPurpose.ADVANCE : PaymentPurpose.FULL_PAYMENT,
          method: PaymentMethod.ONLINE,
          status: "CONFIRMED",
          totalAmount: paymentAmount,
          cashAmount: 0,
          onlineAmount: paymentAmount,
          onlineTransactionRef: booking.transactionId ?? null,
          onlineGateway: "MANUAL_MANAGER_OVERRIDE",
          confirmedById: manager.id,
          confirmedAt: new Date(),
          notes: managerNote ?? "Manually confirmed by branch manager after customer bank proof",
        },
      });

      await staffActivityService.logFromRequest(req, {
        actionType: StaffActionType.CONFIRMED,
        entityType: StaffEntityType.PAYMENT,
        entityRef: booking.publicId,
        description: `Manager manually confirmed payment receipt for booking ${booking.publicId}`,
        metadata: {
          transactionId: booking.transactionId,
          managerNote: managerNote ?? null,
          override: "MANUAL_MANAGER_OVERRIDE",
        },
      }, tx);
    });

    for (const item of booking.items) {
      const key = `vehicle_holds:${item.vehicle.publicId}`;
      await redis.srem(key, booking.publicId);
      const remaining = await redis.scard(key);
      if (remaining === 0) await redis.del(key);
    }
    await redis.del(booking.publicId);

    try {
      await invalidateVehicleAvailability(redis, booking.items.map((i) => i.vehicle.id));
    } catch {
      // non-fatal
    }

    await auditService.log({
      actorId: manager.id,
      actorName: manager.name ?? "Manager",
      actorRole: manager.role,
      actorBranchId: branchId,
      action: "PAYMENT_RECHECK_MANUAL_CONFIRMED",
      category: AuditCategory.PAYMENT,
      description: `Manager manually confirmed payment for booking ${booking.publicId}. Note: ${managerNote ?? "none"}`,
      entity: "Booking",
      entityId: booking.publicId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
      before: { status: BookingStatus.HOLD, paymentStatus: PaymentStatus.CREATED },
      after: { status: BookingStatus.CONFIRMED, paymentStatus: PaymentStatus.SUCCESS },
      metadata: { managerNote, override: "MANUAL_MANAGER_OVERRIDE" },
    });

    return res.status(StatusCode.OK).json({
      success: true,
      message: "Payment manually confirmed. Booking is now CONFIRMED.",
      newStatus: BookingStatus.CONFIRMED,
    });
  } catch (error) {
    console.error("[ManualConfirmPayment] error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
