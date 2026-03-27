import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, ExtensionTrigger } from "@repo/database/client";
import { extensionService } from "../../services/extension/index.js";
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
    const booking = await prisma.booking.findFirst({
      where: {
        publicId: bookingPublicId,
        customer: { publicId: req.public_Id },
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

    // Load extension to verify it belongs to this customer's booking
    const extensionRecord = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      include: {
        booking: {
          select: {
            publicId: true,
            totalFinal: true,
            customer: { select: { publicId: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });

    if (
      !extensionRecord ||
      extensionRecord.booking.customer.publicId !== req.public_Id
    ) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

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

    // Verify ownership
    const extensionRecord = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      include: {
        booking: {
          select: {
            customer: { select: { publicId: true } },
            branch: { select: { name: true } },
          },
        },
      },
    });

    if (
      !extensionRecord ||
      extensionRecord.booking.customer.publicId !== req.public_Id
    ) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

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
