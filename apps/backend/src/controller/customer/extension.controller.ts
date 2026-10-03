import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, ExtensionTrigger, ExtensionStatus, Role } from "@repo/database/client";
import {
  extensionService,
  extensionAvailabilityService,
  ExtensionPendingError,
} from "../../services/extension/index.js";
import {
  createRazorpayOrder,
  fetchOrderStatus,
} from "../../services/payment/razorpay.service.js";
import { confirmExtensionPayment } from "../../services/payment/bookingConfirmation.service.js";
import { UpiQrError } from "../../services/payment/upi-qr.service.js";
import { extensionSplitView } from "../../services/extension/extension-pricing.service.js";
import {
  isGstRuleMissing,
  GST_RULE_MISSING,
  GST_RULE_MISSING_MESSAGE,
} from "../../services/tax/gst.service.js";
import {
  customerEvaluateExtensionSchema,
  cancelExtensionSchema,
  isExtensionPackageDuration,
  extensionPackageOptions,
  packageLabel,
  EXTENSION_PACKAGE_REQUIRED,
  EXTENSION_PACKAGE_REQUIRED_MESSAGE,
} from "@repo/schemas";
import { BookingWindowError } from "../../utils/booking/bookingWindow.js";
import {
  BranchScheduleError,
  loadBranchScheduleConfig,
  validateReturnTime,
} from "../../utils/booking/branchScheduleValidator.js";
import { describeExtensionFreeKm } from "../../services/charges/extension-km.js";
import {
  buildExtensionLimits,
  maxPeriodReachedMessage,
} from "../../services/extension/extension-limits.service.js";
import { findDlConflict, DlInUseError } from "../../services/booking/dl-in-use.service.js";

/**
 * Customers buy extension packages only (+12 h or + N × 24 h). The longest one
 * from `oldEndAt` that ends by `latestEnd` and inside the branch's return
 * hours, or null when not even 12 hours fit.
 */
async function longestPackageEndWithin(
  branchId: number,
  oldEndAt: Date,
  latestEnd: Date,
): Promise<{ endAt: Date; hours: number } | null> {
  const schedule = await loadBranchScheduleConfig(branchId);
  const options = extensionPackageOptions(oldEndAt, latestEnd);
  for (let i = options.length - 1; i >= 0; i--) {
    const option = options[i]!;
    if (!schedule || validateReturnTime(schedule, option.newEndAt).status !== "RETURN_OUTSIDE_HOURS") {
      return { endAt: option.newEndAt, hours: option.hours };
    }
  }
  return null;
}

/**
 * POST /api/user/bookings/:bookingPublicId/extensions/evaluate
 * Customer evaluates an extension for their own booking. Customers extend by
 * packages only — +12 hours or whole days (400 EXTENSION_PACKAGE_REQUIRED
 * otherwise); Fleet / Branch Manager extensions keep any length.
 */
export const EvaluateExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const { bookingPublicId } = req.params;

    const validation = customerEvaluateExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { newEndAt, notes } = validation.data;

    // Load booking — verify it belongs to this customer
    const userForBooking = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { customerProfile: { select: { id: true } } },
    });

    if (!userForBooking?.customerProfile) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found or access denied" });
      return;
    }

    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingPublicId,
        customerId: userForBooking.customerProfile.id,
      },
      select: {
        id: true,
        status: true,
        endAt: true,
        branchId: true,
        branch: { select: { name: true } },
      },
    });

    if (!booking) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found or access denied" });
      return;
    }

    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.PICKED_UP
    ) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: `Extensions are only allowed for CONFIRMED or PICKED_UP bookings. Current status: ${booking.status}`,
      });
      return;
    }

    // Packages only: +12 h or + N × 24 h from the current return (±1 minute).
    // An end at or before the current return keeps the service's own message.
    if (
      new Date(newEndAt).getTime() > booking.endAt.getTime() &&
      !isExtensionPackageDuration(booking.endAt, newEndAt)
    ) {
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: EXTENSION_PACKAGE_REQUIRED,
        message: EXTENSION_PACKAGE_REQUIRED_MESSAGE,
      });
      return;
    }

    const trigger =
      booking.status === BookingStatus.PICKED_UP
        ? ExtensionTrigger.CUSTOMER_AFTER_PICKUP
        : ExtensionTrigger.CUSTOMER_BEFORE_PICKUP;

    // Build customer actor from their profile
    const customer = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true },
    });
    if (!customer) {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "User not found" });
      return;
    }

    const actor = {
      actorId: customer.id,
      actorPublicId: req.public_Id,
      actorName: customer.name,
      actorRole: customer.role,
      actorBranchId: booking.branchId,
      branchName: booking.branch.name,
    };

    const evaluation = await extensionService.evaluate(bookingPublicId!, newEndAt, trigger, actor, notes);

    // Customers can't swap vehicles or pick a resolution: they get their own
    // vehicle for the full request, else the partial extension (the quote is
    // narrowed so the price and the end they pay for match), else nothing.
    const sameVehicle = evaluation.resolutionOptions.find((o) => o.type === "SAME_VEHICLE");
    const partial = evaluation.resolutionOptions.find(
      (o) => o.type === "PARTIAL_EXTENSION" && o.partialNewEndAt,
    );

    let requestedEndAt = evaluation.requestedEndAt;
    let pricing = {
      newDays: evaluation.pricing.newDays,
      additionalAmount: evaluation.pricing.additionalAmount,
      newTotalFinal: evaluation.pricing.newTotalFinal,
      // GST split of additionalAmount (taxableAmount + taxAmount)
      ...extensionSplitView(evaluation.pricing),
      extensionHours: evaluation.pricing.extensionHours,
      // Free km the extension adds (#7) — under 12 h adds none
      extensionFreeKm: evaluation.pricing.extensionFreeKm,
    };
    let options: Array<{ type: string; description: string; partialNewEndAt?: string }>;

    // A partial extension is shortened to the longest package (+12 h / + N × 24 h)
    // that fits before the vehicle's next booking — customers buy packages only
    const partialPackage =
      !sameVehicle && partial
        ? await longestPackageEndWithin(
            booking.branchId,
            new Date(evaluation.oldEndAt),
            new Date(partial.partialNewEndAt!),
          )
        : null;

    if (sameVehicle) {
      options = [sameVehicle];
    } else if (partial && partialPackage) {
      const packageEndIso = partialPackage.endAt.toISOString();
      const narrowed = await extensionService.narrowQuote(evaluation.extensionPublicId, partialPackage.endAt);
      requestedEndAt = packageEndIso;
      pricing = {
        newDays: narrowed.newDays,
        additionalAmount: narrowed.additionalAmount.toFixed(2),
        newTotalFinal: narrowed.newTotalFinal.toFixed(2),
        ...extensionSplitView(narrowed),
        extensionHours: narrowed.extensionHours,
        extensionFreeKm: await describeExtensionFreeKm(booking.id, new Date(evaluation.oldEndAt), partialPackage.endAt),
      };
      options = [
        {
          type: partial.type,
          description: `Your vehicle is booked again soon, so the longest extension available is ${packageLabel(partialPackage.hours)}.`,
          partialNewEndAt: packageEndIso,
        },
      ];
    } else {
      // Nothing a customer can buy — release the quote so the booking stays extendable
      await extensionService.cancel(
        evaluation.extensionPublicId,
        actor,
        "No extension available to the customer for the requested dates",
      );
      options = [
        {
          type: "NO_RESOLUTION",
          description: partial
            ? "Your vehicle is booked again soon after your return, so it can't be extended by 12 hours or more."
            : "No extension is possible for the requested dates.",
        },
      ];
    }

    // Return customer-safe subset (no internal IDs)
    res.status(StatusCode.OK).json({
      message: "Extension evaluated successfully",
      data: {
        extensionPublicId: evaluation.extensionPublicId,
        bookingPublicId: evaluation.bookingPublicId,
        oldEndAt: evaluation.oldEndAt,
        requestedEndAt,
        pricing: {
          originalDays: evaluation.pricing.originalDays,
          newDays: pricing.newDays,
          originalTotalFinal: evaluation.pricing.originalTotalFinal,
          additionalAmount: pricing.additionalAmount,
          newTotalFinal: pricing.newTotalFinal,
          // additionalAmount = taxableAmount + taxAmount (CGST + SGST)
          baseAmount: pricing.baseAmount,
          discountAmount: pricing.discountAmount,
          taxableAmount: pricing.taxableAmount,
          taxAmount: pricing.taxAmount,
          cgstAmount: pricing.cgstAmount,
          sgstAmount: pricing.sgstAmount,
          taxRate: pricing.taxRate,
          originalHours: evaluation.pricing.originalHours,
          extensionHours: pricing.extensionHours,
          extensionFreeKm: pricing.extensionFreeKm,
        },
        resolutionOptions: options.map((o) => ({
          type: o.type,
          description: o.description,
          partialNewEndAt: o.partialNewEndAt,
        })),
        recommendedOption: options[0]!.type,
      },
    });
  } catch (error: any) {
    if (error instanceof ExtensionPendingError) {
      res.status(StatusCode.CONFLICT).json(error.toJSON());
      return;
    }
    if (isGstRuleMissing(error)) {
      res.status(StatusCode.CONFLICT).json({ success: false, code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
      return;
    }
    // 15-day limit (BOOKING_MAX_PERIOD_EXCEEDED) / office hours (BRANCH_SCHEDULE_VIOLATION)
    if (error instanceof BookingWindowError || error instanceof BranchScheduleError) {
      res.status(StatusCode.BAD_REQUEST).json(error.toJSON());
      return;
    }
    // The added time overlaps another booking on the same driving licence (X3) —
    // customer-safe message, the other booking is never named
    if (error instanceof DlInUseError) {
      res.status(error.status).json(error.toJSON("customer"));
      return;
    }
    console.error("Customer EvaluateExtension Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (
      error.message?.includes("pending extension") ||
      error.message?.includes("after the current end date")
    ) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/user/extensions/:extensionPublicId/cancel
 * Customer cancels their own pending extension.
 */
export const CancelExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const { extensionPublicId } = req.params;
    const validation = cancelExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    // Resolve User.publicId → CustomerProfile.id
    const userForCancel = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, customerProfile: { select: { id: true } } },
    });

    if (!userForCancel?.customerProfile) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    // Verify ownership
    const extensionRecord = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      include: {
        booking: {
          select: {
            customerId: true,
            branch: { select: { name: true } },
          },
        },
      },
    });

    if (
      !extensionRecord ||
      extensionRecord.booking.customerId !== userForCancel.customerProfile.id
    ) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    const customer = userForCancel;

    const actor = {
      actorId: customer.id,
      actorPublicId: req.public_Id,
      actorName: customer.name,
      actorRole: customer.role,
      actorBranchId: extensionRecord.branchId,
      branchName: extensionRecord.booking.branch.name,
    };

    // Closes any open UPI QR first (#2): 409 UPI_QR_ALREADY_PAID keeps the
    // extension a QR payment confirmed; 502 GATEWAY_UNAVAILABLE when a code
    // couldn't be closed — never cancel over a QR that can still take money
    await extensionService.cancel(extensionPublicId!, actor, validation.data.reason);

    res.status(StatusCode.OK).json({ message: "Extension cancelled successfully" });
  } catch (error: any) {
    console.error("Customer CancelExtension Error:", error);
    if (error instanceof UpiQrError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("Cannot cancel")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/user/bookings/:bookingPublicId/extension-eligibility
 * Returns whether the extension button should be shown, how many hours remain,
 * and the configured visibility window for this branch.
 */
export const GetExtensionEligibility = async (req: Request, res: Response): Promise<void> => {
  try {
    const { bookingPublicId } = req.params;

    // Resolve User.publicId → CustomerProfile.id
    const user = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { customerProfile: { select: { id: true } } },
    });

    if (!user?.customerProfile) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found or access denied" });
      return;
    }

    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingPublicId,
        customerId: user.customerProfile.id,
      },
      select: {
        status: true,
        startAt: true,
        endAt: true,
        branchId: true,
        activeExtensionId: true,
        rentalPeriodType: true,
      },
    });

    if (!booking) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found or access denied" });
      return;
    }

    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.PICKED_UP
    ) {
      res.status(StatusCode.OK).json({
        data: { eligible: false, reason: `Booking status is ${booking.status}` },
      });
      return;
    }

    if (booking.activeExtensionId !== null) {
      res.status(StatusCode.OK).json({
        data: { eligible: false, reason: "A pending extension already exists for this booking" },
      });
      return;
    }

    const config = await prisma.branchChargeConfig.findUnique({
      where: { branchId: booking.branchId },
      select: {
        extensionThresholdHours: true,
        extensionWindowShortHours: true,
        extensionWindowLongHours: true,
      },
    });

    const thresholdHours = config?.extensionThresholdHours ?? 24;
    const shortWindowHours = config?.extensionWindowShortHours ?? 6;
    const longWindowHours = config?.extensionWindowLongHours ?? 12;

    const now = new Date();
    const hoursUntilEnd =
      (booking.endAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    // 15-day cap (#15) and branch office hours (#2) for the extension pickers
    const limits = await buildExtensionLimits(booking, now);

    // Customers extend by packages (+12 hours, +1 day …) up to the cap; each
    // says whether its return falls inside the branch's return hours.
    const schedule = await loadBranchScheduleConfig(booking.branchId);
    const packageOptions = extensionPackageOptions(booking.endAt, limits.maxEndAt).map((option) => ({
      hours: option.hours,
      label: option.label,
      newEndAt: option.newEndAt.toISOString(),
      insideHours: !schedule || validateReturnTime(schedule, option.newEndAt).status !== "RETURN_OUTSIDE_HOURS",
    }));
    const noPackageFits = !limits.atCap && packageOptions.length === 0;

    // Button is visible for any active booking that hasn't ended yet and still
    // has room for at least the 12-hour package under the maximum rental period.
    const ended = hoursUntilEnd <= 0;
    const eligible = !ended && !limits.atCap && !noPackageFits;

    res.status(StatusCode.OK).json({
      data: {
        eligible,
        hoursUntilEnd: Math.max(0, Math.round(hoursUntilEnd * 10) / 10),
        reason: ended
          ? "Rental has already ended"
          : limits.atCap
            ? maxPeriodReachedMessage(limits)
            : noPackageFits
              ? `Less than 12 hours are left before the ${limits.maxBookingDays}-day limit, so this booking can't be extended.`
              : null,
        ...limits,
        packageOptions,
      },
    });
  } catch (error: any) {
    console.error("GetExtensionEligibility Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/user/extensions/:extensionPublicId/initiate-payment
 * Creates a Razorpay order for a pending customer extension.
 * Returns the order details the client needs to open Razorpay Checkout.
 */
export const InitiateExtensionPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { extensionPublicId } = req.params;

    // Resolve User.publicId → CustomerProfile.id
    const userForPayment = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, customerProfile: { select: { id: true } } },
    });

    if (!userForPayment?.customerProfile) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    const extensionRecord = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      include: {
        booking: {
          select: {
            id: true,
            publicId: true,
            customerId: true,
            status: true,
            endAt: true,
            branch: { select: { name: true } },
            items: { select: { vehicleId: true }, take: 1 },
          },
        },
      },
    });

    if (
      !extensionRecord ||
      extensionRecord.booking.customerId !== userForPayment.customerProfile.id
    ) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    if (extensionRecord.extensionStatus !== ExtensionStatus.PENDING_PAYMENT) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: `Extension is already in ${extensionRecord.extensionStatus} status`,
      });
      return;
    }

    const booking = extensionRecord.booking;
    if (
      booking.status !== BookingStatus.CONFIRMED &&
      booking.status !== BookingStatus.PICKED_UP
    ) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: `Extensions are only allowed for CONFIRMED or PICKED_UP bookings. Current status: ${booking.status}`,
      });
      return;
    }

    // Customers pay without a staff commit, so nothing holds the slot: make
    // sure their vehicle is still free up to the quoted end before charging.
    const vehicleId = booking.items[0]?.vehicleId;
    const availability = vehicleId
      ? await extensionAvailabilityService.checkVehicleAvailability(
          vehicleId,
          booking.endAt,
          extensionRecord.requestedEndAt,
          booking.id,
        )
      : null;
    if (!availability?.available) {
      res.status(StatusCode.CONFLICT).json({
        message: "Your vehicle is no longer free for the new return time. Please check the extension again.",
      });
      return;
    }

    // Same for the driving licence (X3): no other booking on it may have taken
    // the added time since the quote
    const dlConflict = await findDlConflict({
      customerId: booking.customerId,
      mode: "extend",
      window: { startAt: booking.endAt, endAt: extensionRecord.requestedEndAt },
      excludeBookingId: booking.id,
    });
    if (dlConflict) {
      res.status(dlConflict.status).json(dlConflict.toJSON("customer"));
      return;
    }

    const additionalAmount = parseFloat(extensionRecord.additionalAmount.toString());

    // Nothing to pay — confirm right away instead of opening a ₹0 checkout
    if (additionalAmount <= 0) {
      await extensionService.collect(extensionRecord.publicId, "ONLINE", {
        actorId: userForPayment.id,
        actorPublicId: req.public_Id,
        actorName: userForPayment.name,
        actorRole: userForPayment.role,
        actorBranchId: extensionRecord.branchId,
        branchName: booking.branch.name,
      });
      res.status(StatusCode.OK).json({
        message: "Extension confirmed — nothing to pay",
        data: {
          transactionId: null,
          razorpay: null,
          amount: 0,
          extensionStatus: ExtensionStatus.CONFIRMED,
          newEndAt: extensionRecord.requestedEndAt,
        },
      });
      return;
    }

    const order = await createRazorpayOrder(additionalAmount, {
      receipt: extensionRecord.publicId,
      customerPublicId: req.public_Id,
      notes: {
        purpose: "EXTENSION",
        extension_id: extensionRecord.publicId,
        booking_id: booking.publicId,
      },
    });

    // Store the Razorpay order id on the extension for webhook/verify lookup
    await prisma.bookingExtension.update({
      where: { id: extensionRecord.id },
      data: { gatewayTransactionId: order.orderId },
    });

    res.status(StatusCode.OK).json({
      message: "Payment initiated",
      data: {
        transactionId: order.orderId,
        razorpay: {
          orderId: order.orderId,
          keyId: order.keyId,
          amount: order.amount,
          amountInRupees: order.amountInRupees,
          currency: order.currency,
        },
        amount: additionalAmount,
      },
    });
  } catch (error: any) {
    console.error("InitiateExtensionPayment Error:", error);
    if (error.message?.includes("already in")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/user/extensions/verify-payment/:merchantTransactionId
 * Called after Razorpay Checkout closes to verify payment and confirm the
 * extension. Acts as a fallback for when the webhook doesn't fire (e.g. dev/ngrok).
 */
export const VerifyExtensionPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    // Route param keeps its legacy name; the value is now a Razorpay order id.
    const orderId = req.params.merchantTransactionId;

    if (!orderId) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Transaction ID is required" });
      return;
    }

    const extensionRecord = await prisma.bookingExtension.findUnique({
      where: { gatewayTransactionId: orderId },
      include: {
        booking: {
          select: {
            id: true,
            publicId: true,
            branchId: true,
            extensionCount: true,
            createdById: true,
            customerId: true,
          },
        },
      },
    });

    if (!extensionRecord) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found for this transaction" });
      return;
    }

    // Ownership check
    const user = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { customerProfile: { select: { id: true } } },
    });
    if (!user?.customerProfile || extensionRecord.booking.customerId !== user.customerProfile.id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    // Already confirmed — idempotent
    if (extensionRecord.extensionStatus === ExtensionStatus.CONFIRMED) {
      res.status(StatusCode.OK).json({
        status: "CONFIRMED",
        message: "Extension already confirmed",
        data: { newEndAt: extensionRecord.actualNewEndAt },
      });
      return;
    }

    // Ask Razorpay for the settled state of the order.
    // A null result means the gateway was unreachable — unknown, so report
    // PENDING and let the client (or the webhook) retry.
    const gatewayStatus = await fetchOrderStatus(orderId);

    // A definite failure is terminal — report it as such. Collapsing it into
    // PENDING (as the pre-Razorpay code did) left the customer on a "still
    // processing" spinner forever with no way to retry.
    if (gatewayStatus?.state === "FAILED") {
      res.status(StatusCode.OK).json({
        status: "FAILED",
        message: "The payment did not go through. Please try again.",
        data: { gatewayState: "FAILED" },
      });
      return;
    }

    // Null means the gateway was unreachable, PENDING means genuinely in
    // flight. Both are unknown-not-failed: report PENDING and let the client
    // (or the webhook) retry.
    if (!gatewayStatus || gatewayStatus.state !== "SUCCESS") {
      res.status(StatusCode.OK).json({
        status: "PENDING",
        message: "Payment not yet confirmed by Razorpay",
        data: { gatewayState: gatewayStatus?.state ?? "UNKNOWN" },
      });
      return;
    }

    // Confirm through the shared service the webhook and /api/payment/verify
    // also use, so all three paths apply the same guards — a REJECTED or
    // CANCELLED extension, or a cancelled parent booking, is refused rather
    // than confirmed. Inlining this again would let one path silently reverse
    // a manager's decision while the others correctly refuse.
    const { alreadyConfirmed, skipped } = await confirmExtensionPayment({
      extensionId: extensionRecord.id,
      transactionId: orderId,
      gatewayPaymentId: gatewayStatus.paymentId,
      actorName: "Razorpay Checkout",
      actor: {
        ip: req.ip,
        userAgent: req.headers["user-agent"] as string | undefined,
      },
    });

    // Money was captured but the extension cannot be honoured. Terminal, and
    // the customer is owed a refund — report FAILED rather than leaving them
    // on a spinner. The service logs REFUND REQUIRED with the payment id.
    if (skipped) {
      res.status(StatusCode.OK).json({
        status: "FAILED",
        message:
          skipped === "CANCELLED"
            ? "The booking for this extension was cancelled before the payment completed. Any amount debited will be refunded."
            : "This extension is no longer active. Any amount debited will be refunded.",
        data: { reason: skipped },
      });
      return;
    }

    res.status(StatusCode.OK).json({
      status: "CONFIRMED",
      message: alreadyConfirmed ? "Extension already confirmed" : "Extension confirmed successfully",
      data: { newEndAt: extensionRecord.actualNewEndAt ?? extensionRecord.requestedEndAt },
    });
  } catch (error: any) {
    if (error?.code === "P2002" && error?.meta?.target?.includes("idempotencyKey")) {
      // Duplicate — already processed by webhook
      res.status(StatusCode.OK).json({ status: "CONFIRMED", message: "Already confirmed" });
      return;
    }
    console.error("VerifyExtensionPayment Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
