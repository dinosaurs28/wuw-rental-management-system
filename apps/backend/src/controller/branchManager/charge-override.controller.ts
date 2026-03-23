import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { z } from "zod";
const rejectOverrideSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required"),
});
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";

export const ListPendingOverrides = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;

    const overrides = await prisma.chargeOverride.findMany({
      where: {
        status: "PENDING",
        booking: { branchId },
      },
      include: {
        chargeEntry: { select: { publicId: true, moduleKey: true, label: true, chargeType: true } },
        actor: { select: { publicId: true, name: true, role: true } },
        booking: { select: { publicId: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(StatusCode.OK).json({ data: overrides });
  } catch (error) {
    console.error("ListPendingOverrides Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ApproveOverride = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const branchId = req.branch_Id;

    const override = await prisma.chargeOverride.findUnique({
      where: { publicId },
      include: {
        chargeEntry: true,
        booking: { select: { id: true, branchId: true, publicId: true } },
      },
    });

    if (!override || override.booking.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Override not found" });
    }
    if (override.status !== "PENDING") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Override is not pending" });
    }

    // Approve and apply to ChargeEntry in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.chargeOverride.update({
        where: { id: override.id },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
        },
      });

      await tx.chargeEntry.update({
        where: { id: override.chargeEntryId },
        data: {
          finalAmount: override.overriddenAmount,
          isOverridden: true,
        },
      });

      // Increment booking version
      await tx.booking.update({
        where: { id: override.booking.id },
        data: { chargeConfigVersion: { increment: 1 } },
      });
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.APPROVED,
      entityType: StaffEntityType.CHARGE_OVERRIDE,
      entityRef: override.publicId,
      description: `Charge override approved: ₹${override.originalAmount} → ₹${override.overriddenAmount} (waived ₹${override.waivedAmount})`,
      metadata: {
        bookingPublicId: override.booking.publicId,
        originalAmount: override.originalAmount.toString(),
        overriddenAmount: override.overriddenAmount.toString(),
        waivedAmount: override.waivedAmount.toString(),
        reason: override.reason,
      },
    });

    return res.status(StatusCode.OK).json({ message: "Override approved" });
  } catch (error) {
    console.error("ApproveOverride Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const RejectOverride = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const branchId = req.branch_Id;

    const validation = rejectOverrideSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const override = await prisma.chargeOverride.findUnique({
      where: { publicId },
      include: { booking: { select: { id: true, branchId: true, publicId: true } } },
    });

    if (!override || override.booking.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Override not found" });
    }
    if (override.status !== "PENDING") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Override is not pending" });
    }

    await prisma.chargeOverride.update({
      where: { id: override.id },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectionReason: validation.data.rejectionReason,
      },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.REJECTED,
      entityType: StaffEntityType.CHARGE_OVERRIDE,
      entityRef: override.publicId,
      description: `Charge override rejected for booking ${override.booking.publicId}`,
      metadata: { rejectionReason: validation.data.rejectionReason },
    });

    return res.status(StatusCode.OK).json({ message: "Override rejected" });
  } catch (error) {
    console.error("RejectOverride Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
