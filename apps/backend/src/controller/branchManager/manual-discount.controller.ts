import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { applyManualDiscountSchema, rejectManualDiscountSchema } from "@repo/schemas";
import { manualDiscountService } from "../../services/discount/index.js";

const buildActorContext = async (req: Request) => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true, name: true, role: true, branchId: true, branch: { select: { name: true } } },
  });
  if (!user || !user.branchId) throw new Error("Actor not found or has no branch");
  return {
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    actorBranchId: user.branchId,
    actorPublicId: req.public_Id,
    branchName: user.branch?.name ?? "Unknown",
  };
};

export const ApplyManualDiscount = async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const validation = applyManualDiscountSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }

    // Resolve booking internal id from publicId
    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingId },
      select: { id: true, publicId: true, branchId: true },
    });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    const actor = await buildActorContext(req);

    // Branch manager can only apply discounts to their own branch
    if (booking.branchId !== actor.actorBranchId) {
      return res.status(StatusCode.FORBIDDEN).json({ message: "Access denied: booking belongs to a different branch" });
    }

    const discount = await manualDiscountService.issue(
      booking.id,
      booking.publicId,
      validation.data.amount,
      validation.data.reason,
      actor,
    );

    return res.status(StatusCode.CREATED).json({
      message: discount.requiresApproval
        ? "Manual discount issued and pending approval"
        : "Manual discount applied",
      data: {
        publicId: discount.publicId,
        amount: discount.amount,
        status: discount.status,
        requiresApproval: discount.requiresApproval,
      },
    });
  } catch (error: any) {
    console.error("ApplyManualDiscount Error:", error);
    if (error.message?.includes("limit")) return res.status(StatusCode.TOO_MANY_REQUESTS).json({ message: error.message });
    if (error.message?.includes("already been issued")) return res.status(StatusCode.CONFLICT).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ApproveManualDiscount = async (req: Request, res: Response) => {
  try {
    const actor = await buildActorContext(req);
    const discount = await manualDiscountService.approve(req.params.publicId!, actor);
    return res.status(StatusCode.OK).json({ message: "Manual discount approved", data: { publicId: discount.publicId, status: discount.status } });
  } catch (error: any) {
    console.error("ApproveManualDiscount Error:", error);
    if (error.message?.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const RejectManualDiscount = async (req: Request, res: Response) => {
  try {
    const validation = rejectManualDiscountSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
    }
    const actor = await buildActorContext(req);
    const discount = await manualDiscountService.reject(req.params.publicId!, validation.data.rejectionReason, actor);
    return res.status(StatusCode.OK).json({ message: "Manual discount rejected", data: { publicId: discount.publicId, status: discount.status } });
  } catch (error: any) {
    console.error("RejectManualDiscount Error:", error);
    if (error.message?.includes("not found")) return res.status(StatusCode.NOT_FOUND).json({ message: error.message });
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetPendingManualDiscounts = async (req: Request, res: Response) => {
  try {
    const branchId = req.branch_Id;
    const discounts = await manualDiscountService.listPendingForBranch(branchId);
    return res.status(StatusCode.OK).json({ data: discounts });
  } catch (error) {
    console.error("GetPendingManualDiscounts Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetManualDiscount = async (req: Request, res: Response) => {
  try {
    const discount = await manualDiscountService.getByPublicId(req.params.publicId!);
    if (!discount) return res.status(StatusCode.NOT_FOUND).json({ message: "Manual discount not found" });
    return res.status(StatusCode.OK).json({ data: discount });
  } catch (error) {
    console.error("GetManualDiscount Error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
