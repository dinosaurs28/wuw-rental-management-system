import { prisma, PaymentPurpose } from "@repo/database/client";
import Decimal from "decimal.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { computeBookingOwed, creditOutstanding, getBookingMoney, REFUND_PAYMENT_PURPOSES } from "./booking-owed.service.js";
import { getBookingCreditSummary } from "./customer-credit.service.js";
import { CounterGuardError } from "./counter-guard.service.js";
import { StatusCode } from "../../types/statusCode.js";

const ZERO = new Decimal(0);

class FraudDetectionService {
  /**
   * Find all COLLECTED (unconfirmed) transactions older than the branch's
   * delayedCashAlertHours threshold and log a WARNING audit entry for each.
   */
  async checkDelayedCash(branchId: number): Promise<void> {
    const config = await prisma.branchPaymentConfig.findUnique({
      where: { branchId },
      select: { delayedCashAlertHours: true },
    });
    const thresholdHours = config?.delayedCashAlertHours ?? 2;
    const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

    const stale = await prisma.paymentTransaction.findMany({
      where: {
        branchId,
        status: "COLLECTED",
        collectedAt: { lt: cutoff },
      },
      include: {
        booking: { select: { publicId: true } },
        collectedBy: { select: { name: true, publicId: true } },
      },
    });

    // One alert per transaction — this runs hourly and on every start.
    const alreadyAlerted = stale.length
      ? new Set(
          (
            await prisma.auditLog.findMany({
              where: {
                action: "DELAYED_CASH_ALERT",
                entity: "PaymentTransaction",
                entityId: { in: stale.map((t) => t.publicId) },
              },
              select: { entityId: true },
            })
          ).map((a) => a.entityId),
        )
      : new Set<string>();

    for (const txn of stale) {
      if (alreadyAlerted.has(txn.publicId)) continue;
      await auditService.log({
        actorName: "System",
        actorRole: "ADMIN",
        actorBranchId: branchId,
        action: "DELAYED_CASH_ALERT",
        category: AuditCategory.PAYMENT,
        severity: "WARNING",
        description: `Cash collected ${thresholdHours}h+ ago still unconfirmed. Booking: ${txn.booking.publicId}, Collector: ${txn.collectedBy?.name ?? "unknown"}`,
        entity: "PaymentTransaction",
        entityId: txn.publicId,
        metadata: { collectedAt: txn.collectedAt, amount: txn.totalAmount },
      });
    }
  }

  /**
   * Throws if the incoming amount would push what was paid on the booking past
   * what it owes (prevents overpayment beyond what is owed).
   *
   * Owed is the settlement engine's / financial state's total (computeBookingOwed):
   * totalFinal + return charges outside it (the legacy drop's extra km / late return /
   * swap difference with their GST, collected by the branch manager in Settlements,
   * or the Unified Payments drop bill) + the refundable safety deposit held. Paid is
   * money in less refunds paid out — refund rows are never money in. A safety deposit
   * taken counts on both sides, so it never uses up room meant for rental money.
   * A refundable deposit or a refund being recorded isn't a payment against what is
   * owed, so it is not checked.
   */
  async checkExcessPayment(bookingId: number, incomingAmount: Decimal, purpose?: PaymentPurpose): Promise<void> {
    if (purpose && (purpose === PaymentPurpose.SAFETY_DEPOSIT || REFUND_PAYMENT_PURPOSES.includes(purpose))) return;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { publicId: true },
    });
    if (!booking) throw new Error("Booking not found.");

    const [owed, money, credit] = await Promise.all([
      computeBookingOwed(bookingId),
      getBookingMoney(bookingId),
      getBookingCreditSummary(bookingId),
    ]);
    const totalOwed = owed.totalOwed;

    // CONFIRMED + COLLECTED money in, less refunds paid out
    const alreadyCollected = money.netConfirmed.add(money.pending);

    // Money on customer credit (#11) is collected only by clearing it on the
    // Customer Credit page — paid here, its section would stay pending for good
    const onCredit = creditOutstanding(owed, money.netConfirmed, credit?.pending ?? ZERO);
    if (onCredit.gt(ZERO) && alreadyCollected.add(incomingAmount).gt(totalOwed.sub(onCredit))) {
      const collectable = Decimal.max(ZERO, totalOwed.sub(onCredit).sub(alreadyCollected));
      const collateral = credit?.collateral.length ? ` (collateral: ${credit.collateral.join(", ")})` : "";
      throw new CounterGuardError(
        StatusCode.BAD_REQUEST,
        "AMOUNT_ON_CREDIT",
        `₹${onCredit.toFixed(2)} of booking ${booking.publicId} is on customer credit${collateral}. Clear it on the Customer Credit page, which records the payment. ` +
          (collectable.gt(ZERO) ? `Only ₹${collectable.toFixed(2)} can be collected here.` : "Nothing else is due here."),
      );
    }

    if (alreadyCollected.add(incomingAmount).gt(totalOwed)) {
      throw new Error(
        `Payment of ₹${incomingAmount.toFixed(2)} would exceed the booking total of ₹${totalOwed.toFixed(2)}. Already collected: ₹${alreadyCollected.toFixed(2)}.`,
      );
    }
  }

  /**
   * Throws if the employee's total cash handled in their active shift would
   * exceed the branch's maxCashPerEmployee limit.
   */
  async checkEmployeeCashLimit(employeeId: number, branchId: number, incomingAmount: Decimal): Promise<void> {
    const config = await prisma.branchPaymentConfig.findUnique({
      where: { branchId },
      select: { maxCashPerEmployee: true },
    });
    if (!config?.maxCashPerEmployee) return;

    const limit = new Decimal(config.maxCashPerEmployee.toString());

    const shift = await prisma.cashShift.findFirst({
      where: { employeeId, status: "OPEN" },
      select: { id: true },
    });
    if (!shift) return;

    const existing = await prisma.paymentTransaction.aggregate({
      where: {
        cashShiftId: shift.id,
        method: { in: ["CASH", "SPLIT"] },
        status: { in: ["COLLECTED", "CONFIRMED"] },
        // Cash refunds paid out are linked to the shift too — they aren't cash held
        purpose: { notIn: ["OVERPAYMENT_REFUND", "CANCELLATION_REFUND"] },
      },
      _sum: { cashAmount: true },
    });

    const alreadyHeld = new Decimal((existing._sum.cashAmount ?? ZERO).toString());
    if (alreadyHeld.add(incomingAmount).gt(limit)) {
      throw new Error(
        `Employee cash limit of ₹${limit.toFixed(2)} would be exceeded. Currently holding: ₹${alreadyHeld.toFixed(2)}.`,
      );
    }
  }
}

export const fraudDetectionService = new FraudDetectionService();
