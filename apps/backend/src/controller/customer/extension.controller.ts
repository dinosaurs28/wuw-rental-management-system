import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, ExtensionTrigger, ExtensionStatus } from "@repo/database/client";
import { extensionService } from "../../services/extension/index.js";
import { initiatePhonePePayment } from "../../utils/payment/paymentCreate.utils.js";
import {
  customerEvaluateExtensionSchema,
  customerCommitExtensionSchema,
  cancelExtensionSchema,
} from "@repo/schemas";

/**
 * POST /api/user/bookings/:bookingPublicId/extensions/evaluate
 * Customer evaluates an extension for their own booking.
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
        status: true,
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

    // Return customer-safe subset (no internal IDs)
    res.status(StatusCode.OK).json({
      message: "Extension evaluated successfully",
      data: {
        extensionPublicId: evaluation.extensionPublicId,
        bookingPublicId: evaluation.bookingPublicId,
        oldEndAt: evaluation.oldEndAt,
        requestedEndAt: evaluation.requestedEndAt,
        pricing: {
          newDays: evaluation.pricing.newDays,
          additionalAmount: evaluation.pricing.additionalAmount,
          newTotalFinal: evaluation.pricing.newTotalFinal,
        },
        resolutionOptions: evaluation.resolutionOptions.map((o) => ({
          type: o.type,
          description: o.description,
          partialNewEndAt: o.partialNewEndAt,
        })),
        recommendedOption: evaluation.recommendedResolution,
      },
    });
  } catch (error: any) {
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
 * POST /api/user/extensions/commit
 * Customer commits an extension — online payment only.
 */
export const CommitExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = customerCommitExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { extensionPublicId, onlineTransactionRef, onlineGateway, idempotencyKey } =
      validation.data;

    // Resolve User.publicId → CustomerProfile.id
    const userForCommit = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true, name: true, role: true, customerProfile: { select: { id: true } } },
    });

    if (!userForCommit?.customerProfile) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    // Load extension to verify it belongs to this customer's booking
    const extensionRecord = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      include: {
        booking: {
          select: {
            publicId: true,
            totalFinal: true,
            customerId: true,
            branch: { select: { name: true } },
          },
        },
      },
    });

    if (
      !extensionRecord ||
      extensionRecord.booking.customerId !== userForCommit.customerProfile.id
    ) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    const customer = userForCommit;

    const actor = {
      actorId: customer.id,
      actorPublicId: req.public_Id,
      actorName: customer.name,
      actorRole: customer.role,
      actorBranchId: extensionRecord.branchId,
      branchName: extensionRecord.booking.branch.name,
    };

    // Commit: hold vehicle slot
    const { extension } = await extensionService.commit(
      { extensionPublicId, resolutionType: "SAME_VEHICLE", idempotencyKey },
      actor,
    );

    // Collect: process online payment immediately
    const collectResult = await extensionService.collect(
      extensionPublicId,
      "ONLINE",
      actor,
      onlineTransactionRef,
    );

    res.status(StatusCode.OK).json({
      message: "Extension confirmed successfully",
      data: {
        publicId: extension.publicId,
        extensionStatus: collectResult.payment === "confirmed" ? "CONFIRMED" : "PAYMENT_COLLECTED",
        actualNewEndAt: extension.actualNewEndAt,
        additionalAmount: extension.additionalAmount,
      },
    });
  } catch (error: any) {
    console.error("Customer CommitExtension Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (
      error.message?.includes("availability changed") ||
      error.message?.includes("being processed") ||
      error.message?.includes("cannot be committed")
    ) {
      res.status(StatusCode.CONFLICT).json({ message: error.message });
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

    await extensionService.cancel(extensionPublicId!, actor, validation.data.reason);

    res.status(StatusCode.OK).json({ message: "Extension cancelled successfully" });
  } catch (error: any) {
    console.error("Customer CancelExtension Error:", error);
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
    const rentalDurationHours =
      (booking.endAt.getTime() - booking.startAt.getTime()) / (1000 * 60 * 60);
    const hoursUntilEnd =
      (booking.endAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    const isShortRental = rentalDurationHours <= thresholdHours;
    const windowHours = isShortRental ? shortWindowHours : longWindowHours;

    // Button visible when: hoursUntilEnd <= windowHours AND still before end
    const eligible = hoursUntilEnd > 0 && hoursUntilEnd <= windowHours;

    res.status(StatusCode.OK).json({
      data: {
        eligible,
        hoursUntilEnd: Math.max(0, Math.round(hoursUntilEnd * 10) / 10),
        windowHours,
        isShortRental,
        reason: eligible
          ? null
          : hoursUntilEnd > windowHours
          ? `Extension button appears ${windowHours}h before end (${Math.round(hoursUntilEnd - windowHours)}h remaining until then)`
          : "Rental has already ended",
      },
    });
  } catch (error: any) {
    console.error("GetExtensionEligibility Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/user/extensions/:extensionPublicId/initiate-payment
 * Initiates a PhonePe payment for a pending customer extension.
 * Returns the PhonePe redirect URL for the customer to complete payment.
 */
export const InitiateExtensionPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { extensionPublicId } = req.params;
    const { redirectBaseUrl } = req.body;

    // Resolve User.publicId → CustomerProfile.id
    const userForPayment = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { customerProfile: { select: { id: true } } },
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
            publicId: true,
            customerId: true,
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

    const additionalAmount = parseFloat(extensionRecord.additionalAmount.toString());

    const phonePeRedirectBase =
      redirectBaseUrl ||
      process.env.EXTENSION_REDIRECT_URL ||
      process.env.REDIRECT_URL_PAY;

    const paymentData = await initiatePhonePePayment(
      additionalAmount,
      `${phonePeRedirectBase}/extension`,
      req.public_Id,
    );

    // Store PhonePe transaction ID on the extension for webhook lookup
    await prisma.bookingExtension.update({
      where: { id: extensionRecord.id },
      data: { phonePeTransactionId: paymentData.merchantTransactionId },
    });

    res.status(StatusCode.OK).json({
      message: "Payment initiated",
      data: {
        redirectUrl: paymentData.instrumentResponse?.redirectInfo?.url,
        transactionId: paymentData.merchantTransactionId,
        amount: additionalAmount,
      },
    });
  } catch (error: any) {
    console.error("InitiateExtensionPayment Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
