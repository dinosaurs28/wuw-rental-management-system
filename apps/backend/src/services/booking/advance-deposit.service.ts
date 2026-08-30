import { prisma, BookingStatus, DepositMethod, Booking, CancellationInvoice, PaymentStatus, InvoiceStatus, Role } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { auditService } from "../audit/audit.service.js";
import { AuditCategory, AuditSeverity } from "@repo/database/client";

// Helper type for billing breakdown
export interface FinalBillingBreakdown {
  totalBill: string;
  advance: { paid: string; deducted: string };
  deposit: { collected: string; setOff: string; toRefund: string };
  balance: { toPay: string; credit: string };
}

export class AdvanceDepositService {
  
  // ========================================
  // ADVANCE PAYMENT METHODS
  // ========================================
  
  /**
   * Record advance payment after verification
   */
  async recordAdvancePayment(bookingId: number, amount: number, transactionId: string, userId: number): Promise<Booking> {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("Booking not found");
    if (booking.status !== BookingStatus.HOLD) throw new Error("Booking is not in HOLD status");

    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, role: true, branchId: true } });

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        advanceAmount: amount,
        advancePaidAt: new Date(),
        advancePaymentId: transactionId,
        advancePaymentMode: DepositMethod.ONLINE_RAZORPAY,
        status: BookingStatus.CONFIRMED,
        paymentStatus: "SUCCESS",
      }
    });

    await auditService.log({
      actorId: userId,
      actorName: actor?.name ?? "Unknown",
      actorRole: actor?.role ?? Role.CUSTOMER,
      actorBranchId: actor?.branchId ?? undefined,
      action: "RECORD_ADVANCE_PAYMENT",
      category: AuditCategory.PAYMENT,
      description: `Advance payment of ₹${amount} recorded for booking ${bookingId}`,
      entity: "Booking",
      entityId: bookingId.toString(),
      after: { advanceAmount: amount, status: BookingStatus.CONFIRMED, paymentStatus: "SUCCESS" },
    });

    return updatedBooking;
  }
  
  // ========================================
  // REMAINING BALANCE PAYMENT
  // ========================================

  /**
   * Record the remaining balance payment (collected at pickup or return).
   * Marks the invoice as PAID and creates the second payment record.
   */
  async recordRemainingPayment(
    bookingPublicId: string,
    method: DepositMethod,
    transactionId: string,
    paidDuring: "PICKUP" | "RETURN",
  ): Promise<Booking> {
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingPublicId },
      include: { invoice: true },
    });

    if (!booking) throw new Error("Booking not found");
    if (!booking.isAdvancePayment) throw new Error("Booking is not an advance payment booking");
    if (booking.remainingPaidAt) throw new Error("Remaining payment already collected");
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.PICKED_UP
    ) {
      throw new Error("Booking must be CONFIRMED or PICKED_UP to collect remaining payment");
    }

    return await prisma.$transaction(async (tx) => {
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          remainingPaidAt: new Date(),
          remainingPaymentId: transactionId,
          remainingPaymentMode: method,
          remainingPaidDuring: paidDuring,
        },
      });

      // Mark invoice as PAID now that full amount is settled
      if (booking.invoice) {
        await tx.invoice.update({
          where: { id: booking.invoice.id },
          data: { status: InvoiceStatus.PAID },
        });

        // Create the second payment record for the remaining amount
        await tx.payment.create({
          data: {
            publicId: createID(),
            invoiceId: booking.invoice.id,
            method: method,
            status: PaymentStatus.SUCCESS,
            amount: booking.remainingBalance,
          },
        });
      }

      const remainingActor = await tx.user.findUnique({ where: { id: booking.createdById }, select: { name: true, role: true, branchId: true } });
      await auditService.log({
        actorId: booking.createdById,
        actorName: remainingActor?.name ?? "Unknown",
        actorRole: remainingActor?.role ?? Role.CUSTOMER,
        actorBranchId: remainingActor?.branchId ?? undefined,
        action: `REMAINING_PAYMENT_COLLECTED_AT_${paidDuring}`,
        category: AuditCategory.PAYMENT,
        description: `Remaining payment of ₹${booking.remainingBalance} collected at ${paidDuring} for booking ${booking.publicId}`,
        entity: "Booking",
        entityId: booking.publicId,
        after: { remainingPaidDuring: paidDuring, method, amount: booking.remainingBalance.toString() },
      }, tx);

      return updatedBooking;
    });
  }

  // ========================================
  // SAFETY DEPOSIT METHODS
  // ========================================
  
  /**
   * Record safety deposit during vehicle pickup (BM only)
   */
  async recordSafetyDeposit(bookingId: number, amount: number, method: DepositMethod, collectedBy: string): Promise<Booking> {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("Booking not found");
    if (booking.status !== BookingStatus.CONFIRMED && booking.status !== BookingStatus.PICKED_UP) {
      throw new Error("Booking must be CONFIRMED or PICKED_UP");
    }

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        safetyDeposit: amount,
        safetyDepositMethod: method,
        safetyDepositPaidAt: new Date(),
      }
    });

    await auditService.log({
      actorName: collectedBy,
      actorRole: Role.STAFF,
      action: "RECORD_SAFETY_DEPOSIT",
      category: AuditCategory.PAYMENT,
      description: `Safety deposit of ₹${amount} collected for booking ${bookingId}`,
      entity: "Booking",
      entityId: bookingId.toString(),
      after: { safetyDeposit: amount, safetyDepositMethod: method },
    });

    return updatedBooking;
  }
  
  // ========================================
  // NO-SHOW CANCELLATION
  // ========================================
  
  /**
   * Handle no-show cancellation with invoice generation
   */
  async handleNoShowCancellation(bookingId: number, cancelledByPublicId: string, reason: string = "No Show"): Promise<{ booking: Booking; cancellationInvoice: CancellationInvoice }> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { customer: true }
    });
    
    if (!booking) throw new Error("Booking not found");
    if (booking.status === BookingStatus.CANCELLED || booking.status === BookingStatus.RETURNED) {
      throw new Error("Booking cannot be cancelled from current state");
    }

    return await prisma.$transaction(async (tx) => {
      const updatedBooking = await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: new Date(),
          cancellationReason: reason,
        }
      });

      const invoiceNumber = await this.generateInvoiceNumber();
      const advanceAmount = Number(booking.advanceAmount || 0);

      const cancellationInvoice = await tx.cancellationInvoice.create({
        data: {
          publicId: createID(),
          bookingId: bookingId,
          customerId: booking.customerId,
          advanceAmount: advanceAmount,
          cancellationFee: advanceAmount, // Forfeit 100% of advance
          reason: reason,
          invoiceNumber: invoiceNumber,
          generatedAt: new Date(),
        }
      });

      const cancelActor = await tx.user.findUnique({ where: { publicId: cancelledByPublicId }, select: { id: true, name: true, role: true, branchId: true } });
      await auditService.log({
        actorId: cancelActor?.id,
        actorName: cancelActor?.name ?? "Unknown",
        actorRole: cancelActor?.role ?? Role.STAFF,
        actorBranchId: cancelActor?.branchId ?? undefined,
        action: "CANCEL_BOOKING_NO_SHOW",
        category: AuditCategory.BOOKING,
        severity: AuditSeverity.WARNING,
        description: `Booking ${bookingId} cancelled due to no-show`,
        entity: "Booking",
        entityId: bookingId.toString(),
        metadata: { reason, cancelledByPublicId },
      }, tx);

      return { booking: updatedBooking, cancellationInvoice };
    });
  }
  
  // ========================================
  // FINAL BILLING
  // ========================================
  
  /**
   * Process final billing with advance and deposit settlement
   */
  async processFinalBilling(bookingId: number, totalBillAmount: number, customerChoiceSetOff: boolean) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("Booking not found");
    // Ensure it's in a state ready for final billing, usually RETURNED
    if (booking.status !== BookingStatus.RETURNED) {
      throw new Error("Booking must be RETURNED to process final billing");
    }

    let amountToPay = Number(totalBillAmount);
    const advanceAmount = Number(booking.advanceAmount || 0);
    const safetyDeposit = Number(booking.safetyDeposit || 0);

    // STEP 1: Deduct Advance (ALWAYS)
    amountToPay = amountToPay - advanceAmount;

    let depositUsed = 0;
    let depositToRefund = 0;

    // STEP 2: Handle Deposit (Customer Choice)
    if (customerChoiceSetOff && safetyDeposit > 0) {
      if (amountToPay > 0) {
        depositUsed = Math.min(safetyDeposit, amountToPay);
        amountToPay = amountToPay - depositUsed;
        depositToRefund = safetyDeposit - depositUsed;
      } else {
        depositToRefund = safetyDeposit;
      }
    } else {
      depositToRefund = safetyDeposit;
    }

    // STEP 3: Calculate Final
    let finalAmountToPay = 0;
    let creditToCustomer = 0;

    if (amountToPay > 0) {
      finalAmountToPay = amountToPay;
      creditToCustomer = 0;
    } else {
      finalAmountToPay = 0;
      creditToCustomer = Math.abs(amountToPay);
    }

    if (customerChoiceSetOff && depositUsed > 0) {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { safetyDepositSetOff: true }
      });
    }

    return {
      totalBill: totalBillAmount.toFixed(2),
      advance: {
        paid: advanceAmount.toFixed(2),
        deducted: advanceAmount.toFixed(2),
      },
      deposit: {
        collected: safetyDeposit.toFixed(2),
        setOff: depositUsed.toFixed(2),
        toRefund: depositToRefund.toFixed(2),
      },
      balance: {
        toPay: finalAmountToPay.toFixed(2),
        credit: creditToCustomer.toFixed(2),
      }
    } as FinalBillingBreakdown;
  }
  
  // ========================================
  // REFUND PROCESSING
  // ========================================
  
  /**
   * Refund safety deposit to customer
   */
  async refundSafetyDeposit(bookingId: number, amount: number, method: DepositMethod, refundedBy: number): Promise<{ refundId: string; status: string; updatedBooking: Booking }> {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new Error("Booking not found");
    if (booking.safetyDepositRefunded) throw new Error("Safety deposit already refunded");

    // In a real scenario, initiate actual refund if online:
    // if (method === DepositMethod.ONLINE_RAZORPAY) await razorpay.payments.refund(...)

    const updatedBooking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        safetyDepositRefunded: true,
        safetyDepositRefundedAt: new Date(),
      }
    });

    const refundActor = await prisma.user.findUnique({ where: { id: refundedBy }, select: { name: true, role: true, branchId: true } });
    await auditService.log({
      actorId: refundedBy,
      actorName: refundActor?.name ?? "Unknown",
      actorRole: refundActor?.role ?? Role.STAFF,
      actorBranchId: refundActor?.branchId ?? undefined,
      action: "REFUND_SAFETY_DEPOSIT",
      category: AuditCategory.PAYMENT,
      description: `Safety deposit of ₹${amount} refunded for booking ${bookingId}`,
      entity: "Booking",
      entityId: bookingId.toString(),
      after: { safetyDepositRefunded: true, amount, method },
    });

    return { refundId: createID(), status: "SUCCESS", updatedBooking };
  }
  
  // ========================================
  // HELPER METHODS
  // ========================================
  
  /**
   * Get customer cancellation history
   */
  async getCustomerCancellationHistory(customerId: number): Promise<(CancellationInvoice & { booking: Booking })[]> {
    return await prisma.cancellationInvoice.findMany({
      where: { customerId: customerId },
      orderBy: { generatedAt: 'desc' },
      include: { booking: true }
    });
  }
  
  /**
   * Calculate outstanding cancellation fees
   */
  async getOutstandingCancellationFees(customerId: number) {
    const invoices = await prisma.cancellationInvoice.findMany({
      where: { customerId: customerId },
    });
    return invoices.reduce((sum, inv) => sum + Number(inv.cancellationFee), 0);
  }
  
  /**
   * Generate unique cancellation invoice number
   */
  private async generateInvoiceNumber() {
    const date = new Date();
    const yyyymm = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2, '0')}`;
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `CINV-${yyyymm}-${rand}`;
  }
}
