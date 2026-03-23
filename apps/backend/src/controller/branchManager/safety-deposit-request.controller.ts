import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { z } from "zod";
const approveSafetyDepositSchema = z.object({
  approvedAmount: z.coerce.number().positive("Approved amount must be positive"),
});
const rejectSafetyDepositSchema = z.object({
  rejectionReason: z.string().min(1, "Rejection reason is required"),
});
import {
  staffActivityService,
  StaffActionType,
  StaffEntityType,
} from "../../services/staffActivity/staffActivity.service.js";

export const ListPendingSafetyDepositRequests = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;

    const requests = await prisma.safetyDepositRequest.findMany({
      where: {
        status: "PENDING_APPROVAL",
        booking: { branchId },
      },
      include: {
        booking: { select: { publicId: true } },
        requestedBy: { select: { publicId: true, name: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(StatusCode.OK).json({ data: requests });
  } catch (error) {
    console.error("ListPendingSafetyDepositRequests Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ApproveSafetyDepositRequest = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const branchId = req.branch_Id;

    const validation = approveSafetyDepositSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const depositReq = await prisma.safetyDepositRequest.findUnique({
      where: { publicId },
      include: {
        booking: { select: { id: true, branchId: true, publicId: true } },
      },
    });

    if (!depositReq || depositReq.booking.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Safety deposit request not found" });
    }
    if (depositReq.status !== "PENDING_APPROVAL") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Request is not pending approval" });
    }

    const approvedAmount = validation.data.approvedAmount;

    await prisma.$transaction(async (tx) => {
      await tx.safetyDepositRequest.update({
        where: { id: depositReq.id },
        data: {
          status: "APPROVED",
          approvedAmount: String(approvedAmount),
          approvedAt: new Date(),
        },
      });

      // Update booking safety deposit tracking
      await tx.booking.update({
        where: { id: depositReq.booking.id },
        data: {
          safetyDeposit: { increment: approvedAmount },
          safetyDepositPaidAt: new Date(),
        },
      });
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.APPROVED,
      entityType: StaffEntityType.SAFETY_DEPOSIT_REQUEST,
      entityRef: depositReq.publicId,
      description: `Safety deposit request approved: ₹${approvedAmount} for booking ${depositReq.booking.publicId}`,
      metadata: {
        bookingPublicId: depositReq.booking.publicId,
        requestedAmount: depositReq.requestedAmount.toString(),
        approvedAmount: String(approvedAmount),
      },
    });

    return res.status(StatusCode.OK).json({ message: "Safety deposit request approved" });
  } catch (error) {
    console.error("ApproveSafetyDepositRequest Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const RejectSafetyDepositRequest = async (req: Request, res: Response) => {
  try {
    const { publicId } = req.params;
    const branchId = req.branch_Id;

    const validation = rejectSafetyDepositSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "Invalid input",
        errors: validation.error.format(),
      });
    }

    const depositReq = await prisma.safetyDepositRequest.findUnique({
      where: { publicId },
      include: { booking: { select: { branchId: true, publicId: true } } },
    });

    if (!depositReq || depositReq.booking.branchId !== branchId) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Safety deposit request not found" });
    }
    if (depositReq.status !== "PENDING_APPROVAL") {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Request is not pending approval" });
    }

    await prisma.safetyDepositRequest.update({
      where: { id: depositReq.id },
      data: {
        status: "REJECTED",
        rejectedAt: new Date(),
        rejectionReason: validation.data.rejectionReason,
      },
    });

    staffActivityService.logFromRequest(req, {
      actionType: StaffActionType.REJECTED,
      entityType: StaffEntityType.SAFETY_DEPOSIT_REQUEST,
      entityRef: depositReq.publicId,
      description: `Safety deposit request rejected for booking ${depositReq.booking.publicId}`,
      metadata: { rejectionReason: validation.data.rejectionReason },
    });

    return res.status(StatusCode.OK).json({ message: "Safety deposit request rejected" });
  } catch (error) {
    console.error("RejectSafetyDepositRequest Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
