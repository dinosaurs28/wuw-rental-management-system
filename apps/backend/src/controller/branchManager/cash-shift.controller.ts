import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { closeCashShiftSchema, reconcileCashShiftSchema, listCashShiftsSchema } from "@repo/schemas";
import { cashShiftService } from "../../services/payment/index.js";

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

export const OpenShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const actor = await buildActorContext(req);
    const shift = await cashShiftService.open(actor);
    res.status(StatusCode.CREATED).json({
      message: "Cash shift opened",
      data: { publicId: shift.publicId, status: shift.status, openedAt: shift.openedAt },
    });
  } catch (error: any) {
    console.error("OpenShift Error:", error);
    if (error.message?.includes("already have an open shift")) {
      res.status(StatusCode.CONFLICT).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetMyActiveShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: req.public_Id },
      select: { id: true },
    });
    if (!user) {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
      return;
    }
    const shift = await cashShiftService.getActiveShift(user.id);
    res.status(StatusCode.OK).json({ data: shift ?? null });
  } catch (error) {
    console.error("GetMyActiveShift Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const CloseShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = closeCashShiftSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const shift = await cashShiftService.close(
      req.params.publicId!,
      validation.data.actualTotal,
      validation.data.discrepancyExplanation,
      actor,
    );
    res.status(StatusCode.OK).json({
      message: shift.status === "DISCREPANCY_FLAGGED" ? "Shift closed with discrepancy — requires reconciliation" : "Shift closed successfully",
      data: { publicId: shift.publicId, status: shift.status, discrepancy: shift.discrepancy },
    });
  } catch (error: any) {
    console.error("CloseShift Error:", error);
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("discrepancyExplanation") || error.message?.includes("already")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    if (error.message?.includes("own shift")) {
      res.status(StatusCode.FORBIDDEN).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetShiftDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const shift = await cashShiftService.getByPublicId(req.params.publicId!);
    if (!shift) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Shift not found" });
      return;
    }
    res.status(StatusCode.OK).json({ data: shift });
  } catch (error) {
    console.error("GetShiftDetails Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ListBranchShifts = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = listCashShiftsSchema.safeParse(req.query);
    if (!query.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid query", errors: query.error.format() });
      return;
    }
    const result = await cashShiftService.listForBranch(req.branch_Id, query.data);
    res.status(StatusCode.OK).json(result);
  } catch (error) {
    console.error("ListBranchShifts Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ReconcileShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = reconcileCashShiftSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const shift = await cashShiftService.reconcile(req.params.publicId!, validation.data.discrepancyExplanation, actor);
    res.status(StatusCode.OK).json({ message: "Shift reconciled", data: { publicId: shift.publicId, status: shift.status } });
  } catch (error: any) {
    console.error("ReconcileShift Error:", error);
    if (error.message?.includes("Only MANAGER") || error.message?.includes("Only ADMIN")) {
      res.status(StatusCode.FORBIDDEN).json({ message: error.message });
      return;
    }
    if (error.message?.includes("not found")) {
      res.status(StatusCode.NOT_FOUND).json({ message: error.message });
      return;
    }
    if (error.message?.includes("DISCREPANCY_FLAGGED")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
