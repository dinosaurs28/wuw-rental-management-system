import { Request, Response } from "express";
import { z } from "zod";
import Decimal from "decimal.js";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, ExtensionTrigger, ExtensionStatus } from "@repo/database/client";
import { extensionService } from "../../services/extension/index.js";
import {
  evaluateExtensionSchema,
  commitExtensionSchema,
  cancelExtensionSchema,
  listExtensionsSchema,
} from "@repo/schemas";

const collectExtensionSchema = z.object({
  method: z.enum(["CASH", "ONLINE"]),
  onlineTransactionRef: z.string().min(1).optional(),
}).refine(
  (d) => d.method !== "ONLINE" || !!d.onlineTransactionRef?.trim(),
  { message: "onlineTransactionRef is required for ONLINE payment", path: ["onlineTransactionRef"] },
);

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorPublicId: req.public_Id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: req.branch_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

/**
 * POST /api/employee/extensions/evaluate
 * Employee evaluates an extension for a booking they are handling.
 */
export const EvaluateExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = evaluateExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { bookingPublicId, newEndAt, notes } = validation.data;

    // Determine trigger from booking status
    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingPublicId, branchId: req.branch_Id },
      select: { status: true },
    });

    if (!booking) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found or access denied" });
      return;
    }

    const trigger =
      booking.status === BookingStatus.PICKED_UP
        ? ExtensionTrigger.EMPLOYEE_DURING_RENTAL
        : ExtensionTrigger.EMPLOYEE_AT_PICKUP;

    const actor = await buildActorContext(req);
    const evaluation = await extensionService.evaluate(bookingPublicId, newEndAt, trigger, actor, notes);

    res.status(StatusCode.OK).json({
      message: "Extension evaluated successfully",
      data: evaluation,
    });
  } catch (error: any) {
    console.error("EvaluateExtension Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (
      error.message?.includes("Cannot extend") ||
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
 * POST /api/employee/extensions/commit
 * Employee commits an extension by selecting resolution and providing payment.
 */
export const CommitExtension = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = commitExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const actor = await buildActorContext(req);
    const { extension, remainAmount } = await extensionService.commit(validation.data, actor);

    // Check if this branch uses deferred payment sessions so the frontend
    // knows to add the extension charge to the active pickup session instead
    // of collecting payment immediately via Step 3 of the extension modal.
    const branchConfig = await prisma.branchChargeConfig.findUnique({
      where: { branchId: req.branch_Id },
      select: { usePaymentSessions: true },
    });
    const usePaymentSession = branchConfig?.usePaymentSessions ?? false;

    res.status(StatusCode.OK).json({
      message: usePaymentSession
        ? "Extension committed — charge will be added to pickup payment session"
        : "Extension committed — vehicle held, collect payment to confirm",
      data: {
        publicId: extension.publicId,
        extensionStatus: extension.extensionStatus,
        resolutionType: extension.resolutionType,
        additionalAmount: new Decimal(extension.additionalAmount.toString()).toFixed(2),
        remainAmount,
        usePaymentSession,
      },
    });
  } catch (error: any) {
    console.error("CommitExtension Error:", error);
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
 * POST /api/employee/extensions/:extensionPublicId/collect
 * Collect payment for an extension that is PENDING_PAYMENT.
 */
export const CollectExtensionPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = collectExtensionSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Validation failed", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const result = await extensionService.collect(
      req.params.extensionPublicId!,
      validation.data.method,
      actor,
      validation.data.onlineTransactionRef,
    );
    res.status(StatusCode.OK).json({
      message: result.payment === "confirmed" ? "Extension confirmed" : "Extension payment collected — awaiting manager confirmation",
      data: result,
    });
  } catch (error: any) {
    console.error("CollectExtensionPayment Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("already in")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/employee/extensions
 * Employee lists extensions for their branch (optionally filtered by bookingPublicId).
 */
export const ListBookingExtensions = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = listExtensionsSchema.safeParse(req.query);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { page, pageSize, status, bookingPublicId } = validation.data;
    const result = await extensionService.listForBranch(req.branch_Id, {
      page,
      pageSize,
      status: status as ExtensionStatus | undefined,
      bookingPublicId,
    });

    res.status(StatusCode.OK).json({
      message: "Extensions fetched successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("ListBookingExtensions Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * POST /api/employee/extensions/:extensionPublicId/cancel
 * Employee cancels a pending extension.
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

    const actor = await buildActorContext(req);
    await extensionService.cancel(extensionPublicId!, actor, validation.data.reason);

    res.status(StatusCode.OK).json({ message: "Extension cancelled successfully" });
  } catch (error: any) {
    console.error("CancelExtension Error:", error);
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
