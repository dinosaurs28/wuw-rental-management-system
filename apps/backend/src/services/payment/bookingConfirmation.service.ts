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
  AuditCategory,
} from "@repo/database/client";
import { redis } from "../../lib/redisconfig.js";
import { createID } from "../../utils/nanoID.js";
import { auditService } from "../../services/audit/audit.service.js";

interface ConfirmBookingPaymentParams {
  /** Internal Booking.id (not publicId). */
  bookingId: number;
  /** Razorpay order id (`order_xxx`) or the `CASH_xxx` reference. */
  transactionId: string;
  isCash: boolean;
  /** Razorpay `pay_xxx` id, when known. Stored on PaymentTransaction.notes. */
  gatewayPaymentId?: string | null;
  actor: { ip?: string; userAgent?: string };
}

/**
 * Releases the booking hold and every per-vehicle hold for a booking so the
 * vehicles become bookable again. Redis is not transactional, so this always
 * runs outside the Prisma transaction.
 */
async function clearHolds(
  bookingPublicId: string,
  vehiclePublicIds: string[],
  logPrefix: string,
) {
  for (const vehiclePublicId of vehiclePublicIds) {
    const vehicleHoldKey = `vehicle_holds:${vehiclePublicId}`;
    await redis.srem(vehicleHoldKey, bookingPublicId);
    const remaining = await redis.scard(vehicleHoldKey);
    if (remaining === 0) await redis.del(vehicleHoldKey);
    console.log(`${logPrefix} cleared vehicle_holds:${vehiclePublicId}`);
  }
  await redis.del(bookingPublicId);
  console.log(`${logPrefix} cleared hold:${bookingPublicId}`);
}

/**
 * Confirms a booking after a successful payment: flips the booking to
 * CONFIRMED/SUCCESS, frees the held vehicles, and writes the Deposit, Invoice,
 * Payment and PaymentTransaction rows, then clears the Redis holds and audits.
 *
 * Shared by the status poll (checkPayment), the checkout verify endpoint and
 * the Razorpay webhook — all three may race, so it is idempotent: the early
 * return on PaymentStatus.SUCCESS and the unique `initial:<txn>` idempotency
 * key together guarantee a single set of financial rows.
 */
export async function confirmBookingPayment(
  params: ConfirmBookingPaymentParams,
): Promise<{ alreadyConfirmed: boolean; skipped?: "CANCELLED" }> {
  const { bookingId, transactionId, isCash, gatewayPaymentId, actor } = params;

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: {
        include: { vehicle: true },
      },
    },
  });

  if (!booking) {
    throw new Error(`[confirmBookingPayment] booking id=${bookingId} not found`);
  }

  // Idempotency — another caller (verify / webhook / poll) got here first.
  if (booking.paymentStatus === PaymentStatus.SUCCESS) {
    console.log(
      `[confirmBookingPayment] idempotency hit — booking already confirmed bookingId=${booking.publicId}`,
    );
    return { alreadyConfirmed: true };
  }

  // A capture can still land after the hold expired and the booking was
  // cancelled — by then the vehicles may already belong to someone else.
  // Confirming would double-book them, so refuse and surface it for a refund.
  if (booking.status === BookingStatus.CANCELLED) {
    console.error(
      `[confirmBookingPayment] REFUND REQUIRED booking=${booking.publicId} txn=${transactionId} ` +
        `gatewayPaymentId=${gatewayPaymentId ?? "none"} — payment captured against a CANCELLED booking, not confirming`,
    );
    return { alreadyConfirmed: false, skipped: "CANCELLED" };
  }

  // Fetch actor info before the transaction to avoid adding latency inside it
  const paymentActor = await prisma.user.findUnique({
    where: { id: booking.createdById },
    select: { name: true, role: true, branchId: true },
  });

  const method = isCash ? DepositMethod.CASH : DepositMethod.ONLINE_RAZORPAY;

  try {
    console.log(
      `[confirmBookingPayment] starting Prisma transaction to confirm booking=${booking.publicId}`,
    );
    await prisma.$transaction(
      async (tx) => {
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
            // The order id is what every other lookup keys on, so it stays the
            // ref; the pay_xxx id is kept alongside it for reconciliation.
            onlineTransactionRef: isCash ? null : transactionId,
            onlineGateway:       isCash ? null : "RAZORPAY",
            notes:               !isCash && gatewayPaymentId ? `razorpay_payment_id=${gatewayPaymentId}` : null,
            collectedById:       isCash ? booking.createdById : null,
            collectedAt:         isCash ? now : null,
            confirmedById:       txnStatus === "CONFIRMED" ? booking.createdById : null,
            confirmedAt:         txnStatus === "CONFIRMED" ? now : null,
            cashShiftId:         activeShiftId,
          },
        });
      },
      { timeout: 15000 },
    );
  } catch (error: any) {
    // A concurrent caller won the race between the SUCCESS check and the insert.
    if (error?.code === "P2002" && error?.meta?.target?.includes("idempotencyKey")) {
      console.log(
        `[confirmBookingPayment] idempotencyKey conflict — already processed booking=${booking.publicId}`,
      );
      return { alreadyConfirmed: true };
    }
    throw error;
  }

  console.log(
    `[confirmBookingPayment] Prisma transaction committed OK for booking=${booking.publicId}`,
  );

  await clearHolds(
    booking.publicId,
    booking.items.map((item) => item.vehicle.publicId),
    "[confirmBookingPayment]",
  );

  // Audit log outside the transaction to avoid timeout
  await auditService.log({
    actorId: booking.createdById,
    actorName: paymentActor?.name ?? "Unknown",
    actorRole: paymentActor?.role ?? Role.CUSTOMER,
    actorBranchId: paymentActor?.branchId ?? undefined,
    action: booking.isAdvancePayment ? "BOOKING_CONFIRMED_ADVANCE" : "BOOKING_CONFIRMED",
    category: AuditCategory.PAYMENT,
    description: `Booking ${booking.publicId} confirmed via ${isCash ? "cash" : "online"} payment`,
    entity: "Booking",
    entityId: booking.publicId,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
    before: { status: BookingStatus.HOLD },
    after: {
      status: "CONFIRMED",
      paymentStatus: "SUCCESS",
      isAdvancePayment: booking.isAdvancePayment,
    },
  });

  console.log(`[confirmBookingPayment] SUCCESS booking=${booking.publicId} confirmed`);
  return { alreadyConfirmed: false };
}

interface ConfirmExtensionPaymentParams {
  /** Internal BookingExtension.id. */
  extensionId: number;
  /** Razorpay order id (`order_xxx`) stored on BookingExtension.gatewayTransactionId. */
  transactionId: string;
  gatewayPaymentId?: string | null;
  /** Who is credited in the audit trail, e.g. "Razorpay Webhook". */
  actorName: string;
  actor: { ip?: string; userAgent?: string };
}

/**
 * Confirms a customer self-pay booking extension: books the EXTENSION
 * PaymentTransaction, moves the booking's end date and flips the extension to
 * CONFIRMED. Idempotent via the extension status and the unique
 * `ext:razorpay:<order>` key, since verify and the webhook may both fire.
 */
export async function confirmExtensionPayment(
  params: ConfirmExtensionPaymentParams,
): Promise<{ alreadyConfirmed: boolean; skipped?: "CANCELLED" | "EXTENSION_CLOSED" }> {
  const { extensionId, transactionId, gatewayPaymentId, actorName, actor } = params;

  const extensionRecord = await prisma.bookingExtension.findUnique({
    where: { id: extensionId },
    include: {
      booking: {
        select: {
          id: true,
          publicId: true,
          branchId: true,
          extensionCount: true,
          createdById: true,
          status: true,
        },
      },
    },
  });

  if (!extensionRecord) {
    throw new Error(`[confirmExtensionPayment] extension id=${extensionId} not found`);
  }

  // Idempotency — already confirmed
  if (extensionRecord.extensionStatus === "CONFIRMED") {
    return { alreadyConfirmed: true };
  }

  // A manager may have rejected or cancelled the extension while the customer
  // was paying. Confirming here would silently override that decision.
  if (
    extensionRecord.extensionStatus === "REJECTED" ||
    extensionRecord.extensionStatus === "CANCELLED"
  ) {
    console.error(
      `[confirmExtensionPayment] REFUND REQUIRED extension=${extensionRecord.publicId} txn=${transactionId} ` +
        `gatewayPaymentId=${gatewayPaymentId ?? "none"} — payment captured on a ${extensionRecord.extensionStatus} extension, not confirming`,
    );
    return { alreadyConfirmed: false, skipped: "EXTENSION_CLOSED" };
  }

  // The parent booking can be cancelled between initiating and capturing the
  // extension payment. Extending a dead booking would move endAt and bump
  // extensionCount on a rental that is no longer happening.
  if (extensionRecord.booking.status === BookingStatus.CANCELLED) {
    console.error(
      `[confirmExtensionPayment] REFUND REQUIRED extension=${extensionRecord.publicId} txn=${transactionId} ` +
        `gatewayPaymentId=${gatewayPaymentId ?? "none"} — parent booking ${extensionRecord.booking.publicId} is CANCELLED, not confirming`,
    );
    return { alreadyConfirmed: false, skipped: "CANCELLED" };
  }

  const additionalAmount = extensionRecord.additionalAmount;

  try {
    await prisma.$transaction(async (tx) => {
      // Record PaymentTransaction with EXTENSION purpose
      const ptxn = await tx.paymentTransaction.create({
        data: {
          publicId: createID(),
          idempotencyKey: `ext:razorpay:${transactionId}`,
          bookingId: extensionRecord.booking.id,
          branchId: extensionRecord.booking.branchId,
          purpose: PaymentPurpose.EXTENSION,
          method: PaymentMethod.ONLINE,
          status: "CONFIRMED",
          totalAmount: additionalAmount,
          cashAmount: 0,
          onlineAmount: additionalAmount,
          onlineTransactionRef: transactionId,
          onlineGateway: "RAZORPAY",
          notes: gatewayPaymentId ? `razorpay_payment_id=${gatewayPaymentId}` : null,
          confirmedById: extensionRecord.booking.createdById,
          confirmedAt: new Date(),
        },
      });

      // Finalize booking date update
      await tx.booking.update({
        where: { id: extensionRecord.booking.id },
        data: {
          endAt: extensionRecord.requestedEndAt,
          activeExtensionId: null,
          extensionCount: { increment: 1 },
          lastExtendedAt: new Date(),
          totalFinal: extensionRecord.newTotalFinal,
          ...(extensionRecord.booking.extensionCount === 0 && {
            originalEndAt: extensionRecord.oldEndAt,
          }),
        },
      });

      // Confirm extension
      await tx.bookingExtension.update({
        where: { id: extensionRecord.id },
        data: {
          extensionStatus: "CONFIRMED",
          actualNewEndAt: extensionRecord.requestedEndAt,
          paymentTransactionId: ptxn.id,
        },
      });
    });
  } catch (error: any) {
    if (error?.code === "P2002" && error?.meta?.target?.includes("idempotencyKey")) {
      console.log(
        `[confirmExtensionPayment] idempotencyKey conflict — already processed extension=${extensionRecord.publicId}`,
      );
      return { alreadyConfirmed: true };
    }
    throw error;
  }

  await auditService.log({
    actorId: extensionRecord.booking.createdById,
    actorName,
    actorRole: Role.CUSTOMER,
    actorBranchId: extensionRecord.booking.branchId,
    action: "EXTENSION_CONFIRMED_RAZORPAY",
    category: AuditCategory.PAYMENT,
    description: `Extension ${extensionRecord.publicId} confirmed via ${actorName}`,
    entity: "BookingExtension",
    entityId: extensionRecord.publicId,
    ipAddress: actor.ip,
    userAgent: actor.userAgent,
    after: {
      extensionStatus: "CONFIRMED",
      newEndAt: extensionRecord.requestedEndAt,
    },
  });

  console.log(`[confirmExtensionPayment] extension=${extensionRecord.publicId} confirmed`);
  return { alreadyConfirmed: false };
}

/**
 * Marks a booking's payment as failed and cancels it, releasing the booking
 * hold and all per-vehicle holds so the vehicles are immediately bookable again.
 */
export async function failBookingPayment(bookingId: number): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: {
        include: { vehicle: true },
      },
    },
  });

  if (!booking) {
    throw new Error(`[failBookingPayment] booking id=${bookingId} not found`);
  }

  // Never walk back an already-settled payment.
  if (booking.paymentStatus === PaymentStatus.SUCCESS) {
    console.log(
      `[failBookingPayment] booking=${booking.publicId} already SUCCESS — ignoring failure`,
    );
    return;
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: {
      paymentStatus: PaymentStatus.FAILED,
      status: BookingStatus.CANCELLED,
    },
  });

  await clearHolds(
    booking.publicId,
    booking.items.map((item) => item.vehicle.publicId),
    "[failBookingPayment]",
  );

  console.log(`[failBookingPayment] booking=${booking.publicId} cancelled`);
}
