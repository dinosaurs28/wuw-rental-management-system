import { prisma } from "@repo/database/client";
import Decimal from "decimal.js";
import { createID } from "../../utils/nanoID.js";
import { auditService, AuditCategory } from "../audit/audit.service.js";
import { staffActivityService, StaffActionType, StaffEntityType } from "../staffActivity/staffActivity.service.js";
import type { DiscountEvaluationResult } from "./discount-evaluation-engine.service.js";
import type { AdjustmentType, DiscountApplication, DiscountRule, ManualDiscount, Role } from "@repo/database/client";

interface ActorContext {
  actorId: number;
  actorName: string;
  actorRole: Role;
  actorBranchId?: number;
  actorPublicId: string;
  branchName: string;
}

class DiscountApplicationService {
  /**
   * Immutably record a discount application for a booking.
   * Called once after pricing is finalized and booking is created.
   * Will overwrite an existing DiscountApplication for the same booking
   * only if it is a recalculation (same booking, booking still in HOLD).
   */
  async record(
    bookingId: number,
    bookingPublicId: string,
    result: DiscountEvaluationResult,
    paymentPlan: string,
    actor: ActorContext,
  ): Promise<DiscountApplication> {
    const adjustmentType: AdjustmentType = "NONE";

    const application = await prisma.discountApplication.upsert({
      where: { bookingId },
      create: {
        publicId: createID(),
        bookingId,
        originalAmount: result.originalAmount.toDecimalPlaces(2),
        durationDiscountAmount: result.durationDiscount.discountAmount.toDecimalPlaces(2),
        durationDiscountPercent: result.durationDiscount.discountPercent.toDecimalPlaces(4),
        durationSlabId: result.durationDiscount.slabId,
        couponDiscountAmount: result.couponDiscountAmount.toDecimalPlaces(2),
        couponDiscountPercent: result.couponDiscountPercent.toDecimalPlaces(4),
        discountRuleId: result.couponRule?.id ?? null,
        manualDiscountAmount: result.manualDiscountAmount.toDecimalPlaces(2),
        manualDiscountId: result.manualDiscountId ?? null,
        totalDiscountAmount: result.totalDiscountAmount.toDecimalPlaces(2),
        finalAmount: result.finalAmount.toDecimalPlaces(2),
        paymentPlan,
        adjustmentType,
      },
      update: {
        originalAmount: result.originalAmount.toDecimalPlaces(2),
        durationDiscountAmount: result.durationDiscount.discountAmount.toDecimalPlaces(2),
        durationDiscountPercent: result.durationDiscount.discountPercent.toDecimalPlaces(4),
        durationSlabId: result.durationDiscount.slabId,
        couponDiscountAmount: result.couponDiscountAmount.toDecimalPlaces(2),
        couponDiscountPercent: result.couponDiscountPercent.toDecimalPlaces(4),
        discountRuleId: result.couponRule?.id ?? null,
        manualDiscountAmount: result.manualDiscountAmount.toDecimalPlaces(2),
        manualDiscountId: result.manualDiscountId ?? null,
        totalDiscountAmount: result.totalDiscountAmount.toDecimalPlaces(2),
        finalAmount: result.finalAmount.toDecimalPlaces(2),
        paymentPlan,
      },
    });

    // Record coupon usage log — delete any stale log first (handles recalculation)
    if (result.couponValid && result.couponRule && result.appliedCouponCode) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { customerId: true, branchId: true },
      });
      if (booking) {
        await prisma.couponUsageLog.deleteMany({ where: { bookingId } });
        await prisma.couponUsageLog.create({
          data: {
            discountRuleId: result.couponRule.id,
            bookingId,
            customerId: booking.customerId,
            branchId: booking.branchId,
            discountedAmount: result.couponDiscountAmount.toDecimalPlaces(2),
          },
        });
      }
    } else {
      // Coupon was removed/invalidated on recalculation — clean up any existing log
      await prisma.couponUsageLog.deleteMany({ where: { bookingId } });
    }

    // Update booking with coupon code and discountRuleId for quick lookup
    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        couponCode: result.appliedCouponCode ?? null,
        discountRuleId: result.couponRule?.id ?? null,
      },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "APPLY_DISCOUNT",
      category: AuditCategory.DISCOUNT,
      description: `Discount applied to booking ${bookingPublicId}: ₹${result.totalDiscountAmount.toFixed(2)} off (final ₹${result.finalAmount.toFixed(2)})`,
      entity: "DiscountApplication",
      entityId: application.publicId,
      entityLabel: bookingPublicId,
      after: {
        couponCode: result.appliedCouponCode,
        durationDiscount: result.durationDiscount.discountAmount.toFixed(2),
        couponDiscount: result.couponDiscountAmount.toFixed(2),
        manualDiscount: result.manualDiscountAmount.toFixed(2),
        totalDiscount: result.totalDiscountAmount.toFixed(2),
        finalAmount: result.finalAmount.toFixed(2),
      },
    });

    await staffActivityService.log({
      actorPublicId: actor.actorPublicId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      branchId: actor.actorBranchId ?? 0,
      branchName: actor.branchName,
      actionType: StaffActionType.APPLIED,
      entityType: StaffEntityType.DISCOUNT_APPLICATION,
      entityRef: application.publicId,
      description: `Discount applied to booking ${bookingPublicId}`,
      metadata: {
        couponCode: result.appliedCouponCode,
        totalDiscount: result.totalDiscountAmount.toFixed(2),
      },
    });

    return application;
  }

  /**
   * Mark a discount application as having an overpayment that needs adjustment.
   * Called when advance paid > final discounted amount.
   */
  async markAdjustmentNeeded(
    bookingId: number,
    adjustmentType: AdjustmentType,
    actor: ActorContext,
  ): Promise<void> {
    const app = await prisma.discountApplication.findUnique({ where: { bookingId } });
    if (!app) return;

    await prisma.discountApplication.update({
      where: { bookingId },
      data: { adjustmentType },
    });

    await auditService.log({
      actorId: actor.actorId,
      actorName: actor.actorName,
      actorRole: actor.actorRole,
      actorBranchId: actor.actorBranchId,
      action: "DISCOUNT_ADJUSTMENT_FLAGGED",
      category: AuditCategory.DISCOUNT,
      severity: "WARNING",
      description: `Booking ${bookingId}: advance exceeds discounted total — adjustment type: ${adjustmentType}`,
      entity: "DiscountApplication",
      entityId: app.publicId,
      before: { adjustmentType: app.adjustmentType },
      after: { adjustmentType },
    });
  }

  async getByBookingId(bookingId: number): Promise<(DiscountApplication & { discountRule: DiscountRule | null; manualDiscount: ManualDiscount | null }) | null> {
    return prisma.discountApplication.findUnique({
      where: { bookingId },
      include: { discountRule: true, manualDiscount: true },
    });
  }
}

export const discountApplicationService = new DiscountApplicationService();
