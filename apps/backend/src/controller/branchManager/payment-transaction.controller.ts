import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { recordPaymentSchema, listPendingCashSchema } from "@repo/schemas";
import {
  paymentTransactionService,
  financialStateService,
} from "../../services/payment/index.js";
import { CounterGuardError } from "../../services/payment/counter-guard.service.js";
import { proofPhotoFields } from "../../services/payment/payment-proof.service.js";

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
    // Branch-scoped like the settlements pay endpoint: staff and managers can
    // only record money against their own branch's bookings
    const booking = await prisma.booking.findUnique({
      where: { publicId: validation.data.bookingPublicId },
      select: { branchId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
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
    if (error instanceof CounterGuardError) {
      res.status(error.status).json(error.toJSON());
      return;
    }
    console.error("RecordPayment Error:", error);
    if (error.message?.includes("reference is required")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
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
    // Branch-scoped like every other payment read: another branch's transaction
    // (and its customer's private payment-screen photo) is not found here
    if (!txn || txn.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Transaction not found" });
      return;
    }
    // Additive: the UPI payment-screen photo (#3), as a 15-minute URL
    const proofFile = txn.proofFileId
      ? await prisma.fileObject.findUnique({
          where: { id: txn.proofFileId },
          select: { id: true, publicId: true, key: true, mime: true, size: true, createdAt: true },
        })
      : null;
    res.status(StatusCode.OK).json({ data: { ...txn, ...(await proofPhotoFields(proofFile)) } });
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

export const ListBranchTransactions = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const status = req.query.status as string;

    const result = await paymentTransactionService.listAllForBranch(req.branch_Id, {
      page,
      pageSize,
      status,
    });
    res.status(StatusCode.OK).json(result);
  } catch (error) {
    console.error("ListBranchTransactions Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
