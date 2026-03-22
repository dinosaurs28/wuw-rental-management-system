import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { createRefundRequestSchema, rejectRefundSchema, completeRefundSchema } from "@repo/schemas";
import { refundService } from "../../services/payment/index.js";
import type { PaymentMethod } from "@repo/database/client";

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branch: { select: { name: true } } },
  });
  if (!user) throw new Error("Actor not found");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: req.branch_Id,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

export const RequestRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = createRefundRequestSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const refund = await refundService.request(
      validation.data.bookingPublicId,
      validation.data.amount,
      validation.data.reason,
      validation.data.method as PaymentMethod,
      actor,
    );
    res.status(StatusCode.CREATED).json({
      message: refund.status === "PENDING_APPROVAL" ? "Refund request submitted — awaiting manager approval" : "Refund approved and ready to disburse",
      data: { publicId: refund.publicId, status: refund.status, amount: refund.amount },
    });
  } catch (error: any) {
    console.error("RequestRefund Error:", error);
    if (error.message?.includes("exceed") || error.message?.includes("refundable")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    if (error.message?.includes("not enabled")) {
      res.status(StatusCode.FORBIDDEN).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ListPendingRefunds = async (req: Request, res: Response): Promise<void> => {
  try {
    const refunds = await refundService.listPendingForBranch(req.branch_Id);
    res.status(StatusCode.OK).json({ data: refunds });
  } catch (error) {
    console.error("ListPendingRefunds Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const refund = await refundService.getByPublicId(req.params.publicId!);
    if (!refund) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Refund request not found" });
      return;
    }
    res.status(StatusCode.OK).json({ data: refund });
  } catch (error) {
    console.error("GetRefund Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ApproveRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = await buildActorContext(req);
    const refund = await refundService.approve(req.params.publicId!, actor);
    res.status(StatusCode.OK).json({ message: "Refund approved", data: { publicId: refund.publicId, status: refund.status } });
  } catch (error: any) {
    console.error("ApproveRefund Error:", error);
    if (error.message?.includes("Only MANAGER") || error.message?.includes("Only ADMIN")) {
      res.status(StatusCode.FORBIDDEN).json({ message: error.message });
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("Cannot approve")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const RejectRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = rejectRefundSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const refund = await refundService.reject(req.params.publicId!, validation.data.rejectionReason, actor);
    res.status(StatusCode.OK).json({ message: "Refund rejected", data: { publicId: refund.publicId, status: refund.status } });
  } catch (error: any) {
    console.error("RejectRefund Error:", error);
    if (error.message?.includes("Only MANAGER") || error.message?.includes("Only ADMIN")) {
      res.status(StatusCode.FORBIDDEN).json({ message: error.message });
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const CompleteRefund = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = completeRefundSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const refund = await refundService.complete(req.params.publicId!, validation.data.onlineTransactionRef, actor);
    res.status(StatusCode.OK).json({ message: "Refund disbursed", data: { publicId: refund.publicId, status: refund.status } });
  } catch (error: any) {
    console.error("CompleteRefund Error:", error);
    if (error.message?.includes("Approve it first") || error.message?.includes("Cannot complete")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
