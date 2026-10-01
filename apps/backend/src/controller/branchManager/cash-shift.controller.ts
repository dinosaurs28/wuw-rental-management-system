import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import {
  closeCashShiftSchema,
  reconcileCashShiftSchema,
  listCashShiftsSchema,
  listMyCashShiftsSchema,
  openCashShiftSchema,
} from "@repo/schemas";
import { cashShiftService, CashShiftError } from "../../services/payment/index.js";

/** Replies with the shift error contract; false when it isn't a CashShiftError. */
const sendShiftError = (res: Response, error: unknown): boolean => {
  if (error instanceof CashShiftError) {
    res.status(error.status).json(error.toJSON());
    return true;
  }
  return false;
};

/** First validation issue as readable text; query errors name the parameter. */
const firstIssue = (
  error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> },
  fallback: string,
  nameField = false,
): string => {
  const issue = error.issues[0];
  if (!issue) return fallback;
  const field = issue.path.map(String).join(".");
  return nameField && field ? `${field}: ${issue.message}` : issue.message;
};

const resolveUserId = async (req: Request): Promise<number | null> => {
  const user = await prisma.user.findUnique({
    where: { publicId: req.public_Id },
    select: { id: true },
  });
  return user?.id ?? null;
};

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
    // Builds that predate opening cash POST no body — that opens with ₹0.
    const validation = openCashShiftSchema.safeParse(req.body ?? {});
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_OPENING_CASH",
        message: firstIssue(validation.error, "Enter the opening cash as an amount of ₹0 or more."),
        errors: validation.error.format(),
      });
      return;
    }
    const actor = await buildActorContext(req);
    const shift = await cashShiftService.open(actor, validation.data.openingCash ?? 0);
    res.status(StatusCode.CREATED).json({
      message: "Cash shift opened",
      data: {
        publicId: shift.publicId,
        status: shift.status,
        openedAt: shift.openedAt,
        openingCash: shift.openingCash.toFixed(2),
      },
    });
  } catch (error: any) {
    if (sendShiftError(res, error)) return;
    console.error("OpenShift Error:", error);
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
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_INPUT",
        message: firstIssue(validation.error, "Invalid input"),
        errors: validation.error.format(),
      });
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
      data: {
        publicId: shift.publicId,
        status: shift.status,
        discrepancy: shift.discrepancy,
        closedAt: shift.closedAt,
        openingCash: shift.openingCash.toFixed(2),
        cashCollected: shift.cashCollected.toFixed(2),
        cashRefunded: shift.cashRefunded.toFixed(2),
        expectedTotal: shift.expectedTotal.toFixed(2),
        expectedClosing: shift.expectedTotal.toFixed(2),
        actualTotal: shift.actualTotal.toFixed(2),
        closingCash: shift.actualTotal.toFixed(2),
        variance: shift.discrepancy.toFixed(2),
      },
    });
  } catch (error: any) {
    if (sendShiftError(res, error)) return;
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

/** BM: one shift of their branch with its transactions. Other branches read as not found. */
export const GetShiftDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const shift = await cashShiftService.getDetail(req.params.publicId!, { branchId: req.branch_Id }, { legacy: true });
    if (!shift) {
      res.status(StatusCode.NOT_FOUND).json({ success: false, code: "SHIFT_NOT_FOUND", message: "Shift not found" });
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
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_QUERY",
        message: firstIssue(query.error, "Invalid query", true),
        errors: query.error.format(),
      });
      return;
    }
    const result = await cashShiftService.listForBranch(req.branch_Id, query.data);
    res.status(StatusCode.OK).json(result);
  } catch (error) {
    if (sendShiftError(res, error)) return;
    console.error("ListBranchShifts Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/** Fleet Executive: their own shift history (every branch they have worked in). */
export const ListMyShifts = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = listMyCashShiftsSchema.safeParse(req.query);
    if (!query.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_QUERY",
        message: firstIssue(query.error, "Invalid query", true),
        errors: query.error.format(),
      });
      return;
    }
    const userId = await resolveUserId(req);
    if (!userId) {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
      return;
    }
    const result = await cashShiftService.listForEmployee(userId, query.data);
    res.status(StatusCode.OK).json(result);
  } catch (error) {
    if (sendShiftError(res, error)) return;
    console.error("ListMyShifts Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/** Fleet Executive: one of their own shifts with its transactions. */
export const GetMyShiftDetails = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
      return;
    }
    const shift = await cashShiftService.getDetail(req.params.publicId!, { employeeId: userId });
    if (!shift) {
      res.status(StatusCode.NOT_FOUND).json({ success: false, code: "SHIFT_NOT_FOUND", message: "Shift not found" });
      return;
    }
    res.status(StatusCode.OK).json({ data: shift });
  } catch (error) {
    console.error("GetMyShiftDetails Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ReconcileShift = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = reconcileCashShiftSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({
        success: false,
        code: "INVALID_INPUT",
        message: firstIssue(validation.error, "Invalid input"),
        errors: validation.error.format(),
      });
      return;
    }
    const actor = await buildActorContext(req);
    const shift = await cashShiftService.reconcile(req.params.publicId!, validation.data.discrepancyExplanation, actor);
    res.status(StatusCode.OK).json({
      message: "Shift reconciled",
      data: { publicId: shift.publicId, status: shift.status, reconciledAt: shift.reconciledAt },
    });
  } catch (error: any) {
    if (sendShiftError(res, error)) return;
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
