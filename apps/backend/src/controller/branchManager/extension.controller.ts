import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma, BookingStatus, ExtensionTrigger, ExtensionStatus, ExtensionTrigger as ET } from "@repo/database/client";
import { extensionService } from "../../services/extension/index.js";
import {
  evaluateExtensionSchema,
  commitExtensionSchema,
  cancelExtensionSchema,
  listExtensionsSchema,
} from "@repo/schemas";

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
 * POST /api/branchManager/extensions/evaluate
 * Manager evaluates an extension for a booking in their branch.
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

    // Scoped to this manager's branch
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
    console.error("Manager EvaluateExtension Error:", error);
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
 * POST /api/branchManager/extensions/commit
 * Manager commits an extension with full resolution and payment options.
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
    const extension = await extensionService.commit(validation.data, actor);

    res.status(StatusCode.OK).json({
      message:
        extension.extensionStatus === "CONFIRMED"
          ? "Extension confirmed successfully"
          : "Extension payment collected — pending cash confirmation",
      data: {
        publicId: extension.publicId,
        extensionStatus: extension.extensionStatus,
        resolutionType: extension.resolutionType,
        actualNewEndAt: extension.actualNewEndAt,
        additionalAmount: extension.additionalAmount,
        newTotalFinal: extension.newTotalFinal,
        vehicleSwapOccurred: extension.vehicleSwapOccurred,
      },
    });
  } catch (error: any) {
    console.error("Manager CommitExtension Error:", error);
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
 * POST /api/branchManager/extensions/:extensionPublicId/cancel
 * Manager cancels a pending extension in their branch.
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

    // Verify extension belongs to this branch
    const extension = await prisma.bookingExtension.findUnique({
      where: { publicId: extensionPublicId },
      select: { branchId: true },
    });
    if (!extension || extension.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    const actor = await buildActorContext(req);
    await extensionService.cancel(extensionPublicId!, actor, validation.data.reason);

    res.status(StatusCode.OK).json({ message: "Extension cancelled successfully" });
  } catch (error: any) {
    console.error("Manager CancelExtension Error:", error);
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
 * GET /api/branchManager/extensions
 * Manager lists all extensions for their branch with optional filters.
 */
export const ListBranchExtensions = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = listExtensionsSchema.safeParse(req.query);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        message: "Validation failed",
        errors: validation.error.format(),
      });
      return;
    }

    const { page, pageSize, status, bookingPublicId, trigger } = validation.data;
    const result = await extensionService.listForBranch(req.branch_Id, {
      page,
      pageSize,
      status: status as ExtensionStatus | undefined,
      bookingPublicId,
      trigger: trigger as ET | undefined,
    });

    res.status(StatusCode.OK).json({
      message: "Extensions fetched successfully",
      data: result,
    });
  } catch (error: any) {
    console.error("ListBranchExtensions Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/branchManager/extensions/:extensionPublicId
 * Manager retrieves details of a specific extension.
 */
export const GetExtensionDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { extensionPublicId } = req.params;
    const extension = await extensionService.getByPublicId(extensionPublicId!);

    if (!extension || extension.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Extension not found or access denied" });
      return;
    }

    res.status(StatusCode.OK).json({
      message: "Extension fetched successfully",
      data: extension,
    });
  } catch (error: any) {
    console.error("GetExtensionDetail Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/branchManager/extensions/displaced-bookings
 * Manager views bookings displaced by extension conflicts.
 */
export const GetDisplacedBookings = async (req: Request, res: Response): Promise<void> => {
  try {
    const displaced = await extensionService.getDisplacedBookingsForBranch(req.branch_Id);

    res.status(StatusCode.OK).json({
      message: "Displaced bookings fetched successfully",
      data: displaced,
    });
  } catch (error: any) {
    console.error("GetDisplacedBookings Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
