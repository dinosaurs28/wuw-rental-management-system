import { Request, Response } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, PaymentStatus, VehicleStatus, DepositMethod, InvoiceStatus, Role, PaymentMethod, PaymentPurpose } from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { auditService } from "../../services/audit/audit.service.js";
import { AuditCategory } from "@repo/database/client";

const SALT_KEY = process.env.SALT_KEY!;
const SALT_INDEX = process.env.SALT_INDEX!;

export const phonePeWebhook = async (req: Request, res: Response) => {
  try {
    const xVerify = req.headers["x-verify"] as string;
    const base64Body = req.body?.response as string;

    if (!xVerify || !base64Body) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Missing payload" });
    }

    // Verify signature: sha256(base64Body + SALT_KEY) + "###" + SALT_INDEX
    const expectedHash = createHash("sha256")
      .update(base64Body + SALT_KEY)
      .digest("hex") + "###" + SALT_INDEX;

    let signatureValid = false;
    try {
      signatureValid = timingSafeEqual(
        Buffer.from(xVerify),
        Buffer.from(expectedHash),
      );
    } catch {
      signatureValid = false;
    }

    if (!signatureValid) {
      console.warn("[phonePeWebhook] Invalid X-VERIFY signature");
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid signature" });
    }

    const decoded = JSON.parse(Buffer.from(base64Body, "base64").toString("utf8"));
    const { merchantTransactionId: transactionId, code } = decoded;

    if (!transactionId) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Missing transactionId in payload" });
    }

    console.log(`[phonePeWebhook] received transactionId=${transactionId} code=${code}`);

    if (code !== "PAYMENT_SUCCESS") {
      // Not a success — nothing to confirm
      return res.status(StatusCode.OK).json({ message: "Acknowledged" });
    }

    const booking = await prisma.booking.findUnique({
      where: { transactionId },
      include: { items: { include: { vehicle: true } } },
    });

    if (!booking) {
      console.warn(`[phonePeWebhook] booking not found for transactionId=${transactionId}`);
      return res.status(StatusCode.OK).json({ message: "Acknowledged" });
    }

    // Idempotency — already confirmed
    if (booking.paymentStatus === PaymentStatus.SUCCESS) {
      return res.status(StatusCode.OK).json({ message: "Already confirmed" });
    }

    const paymentActor = await prisma.user.findUnique({
      where: { id: booking.createdById },
      select: { name: true, role: true, branchId: true },
    });

    await prisma.$transaction(async (tx) => {
      const bookingUpdateData: any = {
        status: BookingStatus.CONFIRMED,
        paymentStatus: PaymentStatus.SUCCESS,
        holdExpiresAt: null,
        depositMethod: DepositMethod.ONLINE_RAZORPAY,
      };

      if (booking.isAdvancePayment) {
        bookingUpdateData.advancePaidAt = new Date();
        bookingUpdateData.advancePaymentId = transactionId;
        bookingUpdateData.advancePaymentMode = DepositMethod.ONLINE_RAZORPAY;
      }

      await tx.booking.update({ where: { id: booking.id }, data: bookingUpdateData });

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

      const invoiceStatus = booking.isAdvancePayment ? InvoiceStatus.PENDING : InvoiceStatus.PAID;
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

      const now = new Date();
      await tx.paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `initial:${transactionId}`,
          bookingId: booking.id,
          branchId: booking.branchId,
          purpose: booking.isAdvancePayment ? PaymentPurpose.ADVANCE : PaymentPurpose.FULL_PAYMENT,
          method: PaymentMethod.ONLINE,
          status: "CONFIRMED",
          totalAmount: paymentAmount,
          cashAmount: 0,
          onlineAmount: paymentAmount,
          onlineTransactionRef: transactionId,
          onlineGateway: "PHONEPE",
          confirmedById: booking.createdById,
          confirmedAt: now,
        },
      });
    });

    // Clear Redis holds
    for (const item of booking.items) {
      const vehicleHoldKey = `vehicle_holds:${item.vehicle.publicId}`;
      await redis.srem(vehicleHoldKey, booking.publicId);
      const remaining = await redis.scard(vehicleHoldKey);
      if (remaining === 0) await redis.del(vehicleHoldKey);
    }
    await redis.del(booking.publicId);

    await auditService.log({
      actorId: booking.createdById,
      actorName: paymentActor?.name ?? "Unknown",
      actorRole: paymentActor?.role ?? Role.CUSTOMER,
      actorBranchId: paymentActor?.branchId ?? undefined,
      action: booking.isAdvancePayment ? "BOOKING_CONFIRMED_ADVANCE" : "BOOKING_CONFIRMED",
      category: AuditCategory.PAYMENT,
      description: `Booking ${booking.publicId} confirmed via PhonePe webhook`,
      entity: "Booking",
      entityId: booking.publicId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
      before: { status: BookingStatus.HOLD },
      after: { status: "CONFIRMED", paymentStatus: "SUCCESS" },
    });

    console.log(`[phonePeWebhook] booking=${booking.publicId} confirmed via webhook`);
    return res.status(StatusCode.OK).json({ message: "Confirmed" });
  } catch (error: any) {
    // Catch idempotency key constraint violation gracefully
    if (error?.code === "P2002" && error?.meta?.target?.includes("idempotencyKey")) {
      return res.status(StatusCode.OK).json({ message: "Already processed" });
    }
    console.error("[phonePeWebhook] ERROR:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal error" });
  }
};
