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
import { claimUtr, CounterGuardError, normalizeUtr } from "./counter-guard.service.js";
import { claimPaymentProof } from "./payment-proof.service.js";
import { addFleetCredit } from "./customer-credit.service.js";
import Decimal from "decimal.js";
import { refreshBookingPeriodFields } from "../../utils/booking/rentalPeriod.js";
import { discountApplicationService } from "../discount/discount-application.service.js";
import { initialInvoiceGstData, refreshInvoiceTotals } from "../invoice-totals.service.js";
import { notifyEvents } from "../notification/notification.events.js";

interface ConfirmBookingPaymentParams {
  /** Internal Booking.id (not publicId). */
  bookingId: number;
  /** Razorpay order id (`order_xxx`) or the `CASH_xxx` / `UPI_xxx` reference. */
  transactionId: string;
  isCash: boolean;
  /** Counter UPI payment — the UTR / payment photo is read from `pricingSnapshot.upi`. */
  isUpi?: boolean;
  /** Counter split (cash + UPI) — the parts and the UPI backing are read from `pricingSnapshot.split` (#11). */
  isSplit?: boolean;
  /** Counter credit — nothing paid; the collateral is read from `pricingSnapshot.credit` (#11). */
  isCredit?: boolean;
  /** Razorpay `pay_xxx` id, when known. Stored on PaymentTransaction.notes. */
  gatewayPaymentId?: string | null;
  /**
   * The caller sends its own refund notice when the payment can't be applied
   * (UPI QR: it names the QR's `pay_xxx`, never attached to the order), so the
   * order-level PAYMENT_NEEDS_REFUND notice is skipped.
   */
  callerNotifiesRefund?: boolean;
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
 *
 * `skipped: "DUPLICATE_UTR"` means a counter UPI booking's UTR was claimed by
 * another payment after the booking was created; `"DUPLICATE_PAYMENT_PROOF"`
 * the same for its payment photo (#3). The caller cancels the hold.
 */
export async function confirmBookingPayment(
  params: ConfirmBookingPaymentParams,
): Promise<{ alreadyConfirmed: boolean; skipped?: "CANCELLED" | "DUPLICATE_UTR" | "DUPLICATE_PAYMENT_PROOF" }> {
  const { bookingId, transactionId, isCash, isUpi = false, isSplit = false, isCredit = false, gatewayPaymentId, callerNotifiesRefund = false, actor } = params;
  // Taken at the counter without a gateway: the hold lapsing just means staff re-create it
  const isCounterNoGateway = isUpi || isSplit || isCredit;

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
  // A counter UPI hold that lapsed (HOLD_EXPIRED) is refused the same way —
  // staff re-create the booking and the UTR is still free to use.
  if (
    booking.status === BookingStatus.CANCELLED ||
    (isCounterNoGateway && booking.status === BookingStatus.HOLD_EXPIRED)
  ) {
    console.error(
      isCounterNoGateway
        ? `[confirmBookingPayment] counter booking=${booking.publicId} is ${booking.status} — not confirming; staff re-create it`
        : `[confirmBookingPayment] REFUND REQUIRED booking=${booking.publicId} txn=${transactionId} ` +
            `gatewayPaymentId=${gatewayPaymentId ?? "none"} — payment captured against a ${booking.status} booking, not confirming`,
    );
    if (!isCounterNoGateway && !isCash && !callerNotifiesRefund) {
      void notifyEvents.paymentNeedsRefund({ bookingId: booking.id, transactionId });
    }
    return { alreadyConfirmed: false, skipped: "CANCELLED" };
  }

  // The UTR / payment photo given at booking time rides on the pricing snapshot
  // until now (UPI: `upi`; split: `split` with its cash and UPI parts; credit: `credit`).
  const snapshot = booking.pricingSnapshot as {
    upi?: { utr?: string | null; proofFileId?: string | null };
    split?: { cash?: number; upi?: number; utr?: string | null; proofFileId?: string | null };
    credit?: { collateral?: string };
  } | null;
  const counterSnap = isUpi ? snapshot?.upi : isSplit ? snapshot?.split : undefined;
  const proofFile = counterSnap?.proofFileId
    ? await prisma.fileObject.findUnique({
        where: { publicId: counterSnap.proofFileId },
        select: { id: true, publicId: true },
      })
    : null;
  // Older holds carry only a UTR — still required then (INVALID_UTR as before)
  const upiUtr = (isUpi || isSplit) && (counterSnap?.utr || !proofFile)
    ? normalizeUtr(counterSnap?.utr)
    : null;
  const splitCash = isSplit ? new Decimal(String(snapshot?.split?.cash ?? 0)) : null;
  const splitUpi = isSplit ? new Decimal(String(snapshot?.split?.upi ?? 0)) : null;
  const creditCollateral = isCredit ? (snapshot?.credit?.collateral ?? "").trim() : null;
  if (isSplit && (!splitCash!.gt(0) || !splitUpi!.gt(0))) {
    throw new Error(`[confirmBookingPayment] split booking=${booking.publicId} has no cash/UPI parts on its snapshot`);
  }
  if (isCredit && !creditCollateral) {
    throw new Error(`[confirmBookingPayment] credit booking=${booking.publicId} has no collateral on its snapshot`);
  }

  // Fetch actor info before the transaction to avoid adding latency inside it
  const paymentActor = await prisma.user.findUnique({
    where: { id: booking.createdById },
    select: { name: true, role: true, branchId: true },
  });

  // A split's cash part is what awaits the manager; credit takes no money at all
  const method = isCash || isSplit
    ? DepositMethod.CASH
    : isUpi
      ? DepositMethod.UPI
      : isCredit
        ? null
        : DepositMethod.ONLINE_RAZORPAY;

  try {
    console.log(
      `[confirmBookingPayment] starting Prisma transaction to confirm booking=${booking.publicId}`,
    );
    await prisma.$transaction(
      async (tx) => {
        // Claim inside the transaction: the UTR / payment photo may have been used
        // for another payment while this booking sat on HOLD.
        if (upiUtr) await claimUtr(upiUtr, tx);
        if (proofFile) await claimPaymentProof(proofFile, tx);

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

        // A late capture can confirm a hold whose coupon use was given back when
        // it expired — the coupon is used after all, so record the use again
        if (booking.discountRuleId) {
          const usage = await tx.couponUsageLog.findFirst({ where: { bookingId: booking.id }, select: { id: true } });
          if (!usage) {
            // What the coupon took off the GST-inclusive rent (item 17; older snapshots: taxable terms)
            const snapshotTotals = (booking.pricingSnapshot as {
              totals?: { grandCouponDiscountTotal?: number; grandCouponDiscountInclGst?: number };
            } | null)?.totals;
            await tx.couponUsageLog.create({
              data: {
                discountRuleId: booking.discountRuleId,
                bookingId: booking.id,
                customerId: booking.customerId,
                branchId: booking.branchId,
                discountedAmount: Number(
                  snapshotTotals?.grandCouponDiscountInclGst ?? snapshotTotals?.grandCouponDiscountTotal ?? 0,
                ).toFixed(2),
              },
            });
          }
        }

        await tx.vehicle.updateMany({
          where: {
            id: { in: booking.items.map((i) => i.vehicleId) },
          },
          data: {
            status: VehicleStatus.AVAILABLE,
          },
        });

        // Credit: no deposit money was taken
        if (booking.totalDeposit.gt(0) && method) {
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
        // For full payment: invoice is PAID immediately — unless it is on credit.
        const invoiceStatus = booking.isAdvancePayment || isCredit
          ? InvoiceStatus.PENDING
          : InvoiceStatus.PAID;

        const invoice = await tx.invoice.create({
          data: {
            publicId: createID(),
            bookingId: booking.id,
            subtotal: booking.totalBase,
            discount: booking.totalDiscount,
            damageCharges: 0,
            total: booking.totalFinal,
            status: invoiceStatus,
            // GST stored on the booking items (tax, taxable, CGST/SGST, deposit)
            ...(await initialInvoiceGstData(booking.id, tx)),
          },
        });

        // Payment record reflects the actual amount charged (advance or full)
        const paymentAmount = booking.isAdvancePayment
          ? booking.advanceAmount
          : booking.totalFinal;

        // Credit (#11): nothing was paid — no payment rows; the booking's credit
        // entry records what is owed and the collateral held, and the financial
        // state keeps it due until the branch manager clears it.
        if (method === null) {
          const existing = await tx.customerCreditEntry.findUnique({
            where: { bookingId: booking.id },
            select: { sections: true },
          });
          const sectionKey = `credit:walkin:${booking.publicId}`;
          const already = ((existing?.sections as Array<{ sectionKey?: string }> | null) ?? []).some(
            (s) => s.sectionKey === sectionKey,
          );
          if (!already) {
            await addFleetCredit(tx, {
              bookingId: booking.id,
              amount: new Decimal(booking.totalFinal.toString()),
              purpose: PaymentPurpose.FULL_PAYMENT,
              label: "Walk-in booking on credit",
              collateral: creditCollateral!,
              reference: { type: "WALKIN", publicId: booking.publicId },
              actor: { id: booking.createdById, name: paymentActor?.name ?? "Fleet Executive" },
            });
          }
          return;
        }

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
        // A split's cash part does too. Online payments (Razorpay and counter UPI)
        // confirm immediately.
        let activeShiftId: number | null = null;
        const collectedAtCounter = isCash || isUpi || isSplit;

        if (collectedAtCounter) {
          const activeShift = await (tx as any).cashShift.findFirst({
            where: { employeeId: booking.createdById, status: "OPEN" },
            select: { id: true },
          });
          activeShiftId = activeShift?.id ?? null;
        }

        const txnStatus = isCash || isSplit ? "COLLECTED" : "CONFIRMED";
        const now = new Date();

        await tx.paymentTransaction.create({
          data: {
            publicId:            createID(),
            idempotencyKey:      `initial:${transactionId}`,
            bookingId:           booking.id,
            branchId:            booking.branchId,
            purpose:             booking.isAdvancePayment ? PaymentPurpose.ADVANCE : PaymentPurpose.FULL_PAYMENT,
            method:              isCash ? PaymentMethod.CASH : isSplit ? PaymentMethod.SPLIT : PaymentMethod.ONLINE,
            status:              txnStatus,
            totalAmount:         paymentAmount,
            cashAmount:          isCash ? paymentAmount : isSplit ? splitCash!.toFixed(2) : 0,
            onlineAmount:        isCash ? 0 : isSplit ? splitUpi!.toFixed(2) : paymentAmount,
            // The order id is what every other lookup keys on, so it stays the
            // ref; the pay_xxx id is kept alongside it for reconciliation.
            // Counter UPI payments are keyed on the customer's UTR instead.
            onlineTransactionRef: isCash ? null : (upiUtr ?? transactionId),
            onlineGateway:       isCash ? null : isUpi || isSplit ? "UPI" : "RAZORPAY",
            // Photo of the customer's payment screen (#3)
            proofFileId:         proofFile?.id ?? null,
            notes:               !isCash && gatewayPaymentId ? `razorpay_payment_id=${gatewayPaymentId}` : null,
            collectedById:       collectedAtCounter ? booking.createdById : null,
            collectedAt:         collectedAtCounter ? now : null,
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
    // The racing confirm can also land first on the booking's one Deposit /
    // Invoice row (e.g. UPI QR webhook + poll + checkout verify at once)
    if (error?.code === "P2002") {
      const latest = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { paymentStatus: true },
      });
      if (latest?.paymentStatus === PaymentStatus.SUCCESS) {
        console.log(
          `[confirmBookingPayment] unique conflict (${error?.meta?.target}) — already processed booking=${booking.publicId}`,
        );
        return { alreadyConfirmed: true };
      }
    }
    // A concurrent confirm of this same booking also trips the UTR check once
    // its row commits — only a UTR used elsewhere is a real duplicate.
    if (
      error instanceof CounterGuardError &&
      (error.code === "DUPLICATE_UTR" || error.code === "DUPLICATE_PAYMENT_PROOF")
    ) {
      const latest = await prisma.booking.findUnique({
        where: { id: booking.id },
        select: { paymentStatus: true },
      });
      if (latest?.paymentStatus === PaymentStatus.SUCCESS) return { alreadyConfirmed: true };
      // Report what actually clashed: the payment photo (new UIs) or the UTR (old builds)
      const clash = error.code === "DUPLICATE_PAYMENT_PROOF" ? `payment photo ${proofFile?.publicId}` : `UTR ${upiUtr}`;
      console.error(
        `[confirmBookingPayment] ${clash} already used elsewhere — not confirming booking=${booking.publicId}`,
      );
      return { alreadyConfirmed: false, skipped: error.code };
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
    description: `Booking ${booking.publicId} confirmed via ${
      isCash
        ? "cash"
        : isUpi
          ? proofFile ? "UPI (payment photo)" : "UPI (UTR)"
          : isSplit
            ? "split (cash + UPI)"
            : isCredit
              ? `customer credit (collateral: ${creditCollateral})`
              : "online"
    } payment`,
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

  void notifyEvents.bookingConfirmed({ bookingId: booking.id, actorUserId: booking.createdById });

  console.log(`[confirmBookingPayment] SUCCESS booking=${booking.publicId} confirmed`);
  return { alreadyConfirmed: false };
}

interface ConfirmExtensionPaymentParams {
  /** Internal BookingExtension.id. */
  extensionId: number;
  /** Razorpay order id (`order_xxx`) stored on BookingExtension.gatewayTransactionId. */
  transactionId: string;
  gatewayPaymentId?: string | null;
  /** The caller sends its own refund notice naming the payment (UPI QR) — skip the order-level one. */
  callerNotifiesRefund?: boolean;
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
  const { extensionId, transactionId, gatewayPaymentId, callerNotifiesRefund = false, actorName, actor } = params;

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
    if (!callerNotifiesRefund) {
      void notifyEvents.paymentNeedsRefund({ bookingId: extensionRecord.booking.id, transactionId, extensionId: extensionRecord.id });
    }
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
    if (!callerNotifiesRefund) {
      void notifyEvents.paymentNeedsRefund({ bookingId: extensionRecord.booking.id, transactionId, extensionId: extensionRecord.id });
    }
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
          totalFinal: { increment: extensionRecord.additionalAmount },
          ...(extensionRecord.booking.extensionCount === 0 && {
            originalEndAt: extensionRecord.oldEndAt,
          }),
        },
      });
      // days / rentalPeriodType / hours follow the extended end (#5/#17)
      await refreshBookingPeriodFields(extensionRecord.booking.id, tx);

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

  // The confirmed extension (taxable + GST) now belongs on the invoice
  refreshInvoiceTotals(extensionRecord.booking.id).catch((err) =>
    console.error("[confirmExtensionPayment] Invoice refresh error:", err),
  );

  void notifyEvents.extensionConfirmed({ extensionId: extensionRecord.id, notifyBranch: true });

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

  // Cancel and give the coupon use back together — the customer never paid
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: PaymentStatus.FAILED,
        status: BookingStatus.CANCELLED,
      },
    });
    await discountApplicationService.releaseUsage(booking.id, tx);
  });

  await clearHolds(
    booking.publicId,
    booking.items.map((item) => item.vehicle.publicId),
    "[failBookingPayment]",
  );

  console.log(`[failBookingPayment] booking=${booking.publicId} cancelled`);
}
