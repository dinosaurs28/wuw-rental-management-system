import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { recordPaymentSchema, listPendingCashSchema } from "@repo/schemas";
import {
  paymentTransactionService,
  financialStateService,
} from "../../services/payment/index.js";

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

export const RecordPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const validation = recordPaymentSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }
    const actor = await buildActorContext(req);
    const txn = await paymentTransactionService.record(validation.data, actor);
    res.status(StatusCode.CREATED).json({
      message: txn.status === "COLLECTED" ? "Cash collected — awaiting manager confirmation" : "Payment recorded and confirmed",
      data: {
        publicId: txn.publicId,
        status: txn.status,
        purpose: txn.purpose,
        method: txn.method,
        totalAmount: txn.totalAmount,
      },
    });
  } catch (error: any) {
    console.error("RecordPayment Error:", error);
    if (error.message?.includes("limit") || error.message?.includes("exceed")) {
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

export const GetPaymentTransaction = async (req: Request, res: Response): Promise<void> => {
  try {
    const txn = await paymentTransactionService.getByPublicId(req.params.publicId!);
    if (!txn) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Transaction not found" });
      return;
    }
    res.status(StatusCode.OK).json({ data: txn });
  } catch (error) {
    console.error("GetPaymentTransaction Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ListBookingPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingPublicId! },
      select: { id: true, branchId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }
    const txns = await paymentTransactionService.listForBooking(booking.id);
    res.status(StatusCode.OK).json({ data: txns });
  } catch (error) {
    console.error("ListBookingPayments Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetFinancialState = async (req: Request, res: Response): Promise<void> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingPublicId! },
      select: { id: true, branchId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }
    const state = await financialStateService.getState(booking.id);
    res.status(StatusCode.OK).json({ data: state });
  } catch (error) {
    console.error("GetFinancialState Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const ListPendingCash = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = listPendingCashSchema.safeParse(req.query);
    if (!query.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid query", errors: query.error.format() });
      return;
    }
    const result = await paymentTransactionService.listPendingCashForBranch(req.branch_Id, query.data);
    res.status(StatusCode.OK).json(result);
  } catch (error) {
    console.error("ListPendingCash Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
