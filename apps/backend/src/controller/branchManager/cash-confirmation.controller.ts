import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { confirmCashPaymentSchema, rejectCashPaymentSchema } from "@repo/schemas";
import { paymentTransactionService } from "../../services/payment/index.js";

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

export const ConfirmCashPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = confirmCashPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const txn = await paymentTransactionService.confirmCash(req.params.publicId!, validation.data.notes, actor);
    res.status(StatusCode.OK).json({ message: "Cash payment confirmed", data: { publicId: txn.publicId, status: txn.status } });
  } catch (error: any) {
    console.error("ConfirmCashPayment Error:", error);
    if (error.message?.includes("Only MANAGER") || error.message?.includes("Only ADMIN")) {
      res.status(StatusCode.FORBIDDEN).json({ message: error.message });
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("Cannot confirm")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const RejectCashPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = rejectCashPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const txn = await paymentTransactionService.rejectCash(req.params.publicId!, validation.data.rejectionReason, actor);
    res.status(StatusCode.OK).json({ message: "Cash payment rejected", data: { publicId: txn.publicId, status: txn.status } });
  } catch (error: any) {
    console.error("RejectCashPayment Error:", error);
    if (error.message?.includes("Only MANAGER") || error.message?.includes("Only ADMIN")) {
      res.status(StatusCode.FORBIDDEN).json({ message: error.message });
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("Cannot reject")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
