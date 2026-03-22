import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";

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

    for (const txn of stale) {
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
   * Throws if the incoming amount would push the booking's total collected
   * past its totalFinal (prevents overpayment beyond what is owed).
   */
  async checkExcessPayment(bookingId: number, incomingAmount: Decimal): Promise<void> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { totalFinal: true, publicId: true },
    });
    if (!booking) throw new Error("Booking not found.");

    const totalFinal = new Decimal(booking.totalFinal.toString());

    const existing = await prisma.paymentTransaction.aggregate({
      where: {
        bookingId,
        status: { in: ["CONFIRMED", "COLLECTED"] },
      },
      _sum: { totalAmount: true },
    });

    const alreadyCollected = new Decimal((existing._sum.totalAmount ?? ZERO).toString());
    if (alreadyCollected.add(incomingAmount).gt(totalFinal)) {
      throw new Error(
        `Payment of ₹${incomingAmount.toFixed(2)} would exceed the booking total of ₹${totalFinal.toFixed(2)}. Already collected: ₹${alreadyCollected.toFixed(2)}.`,
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
