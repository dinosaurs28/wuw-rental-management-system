import { Request, Response } from "express";
import { StatusCode } from "../../types/statusCode.js";
import { prisma } from "@repo/database/client";
import { listPendingSettlementsSchema, recordPaymentSchema } from "@repo/schemas";
import { settlementEngineService, paymentTransactionService } from "../../services/payment/index.js";

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

export const ListPendingSettlements = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = listPendingSettlementsSchema.safeParse(req.query);
    if (!query.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid query", errors: query.error.format() });
      return;
    }
    const result = await settlementEngineService.listPendingSettlements(req.branch_Id, query.data);
    res.status(StatusCode.OK).json(result);
  } catch (error) {
    console.error("ListPendingSettlements Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const GetSettlementSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingPublicId! },
      select: { id: true, branchId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }
    const summary = await settlementEngineService.calculateSettlement(booking.id);
    res.status(StatusCode.OK).json({ data: summary });
  } catch (error) {
    console.error("GetSettlementSummary Error:", error);
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

export const RecordSettlementPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    // Verify booking belongs to this branch and is in RETURNED status
    const booking = await prisma.booking.findUnique({
      where: { publicId: req.params.bookingPublicId! },
      select: { id: true, branchId: true, status: true, publicId: true },
    });
    if (!booking || booking.branchId !== req.branch_Id) {
      res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
      return;
    }
    if (booking.status !== "RETURNED") {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Settlement payments can only be recorded for RETURNED bookings." });
      return;
    }

    // Inject the bookingPublicId from the URL — caller should not re-specify it
    const body = { ...req.body, bookingPublicId: booking.publicId };

    const validation = recordPaymentSchema.safeParse(body);
    if (!validation.success) {
      res.status(StatusCode.BAD_REQUEST).json({ message: "Invalid input", errors: validation.error.format() });
      return;
    }

    const actor = await buildActorContext(req);
    const txn = await paymentTransactionService.record(validation.data, actor);

    res.status(StatusCode.CREATED).json({
      message: txn.status === "COLLECTED" ? "Settlement cash collected — awaiting manager confirmation" : "Settlement payment recorded",
      data: { publicId: txn.publicId, status: txn.status, totalAmount: txn.totalAmount },
    });
  } catch (error: any) {
    console.error("RecordSettlementPayment Error:", error);
    if (error.message?.includes("exceed") || error.message?.includes("limit")) {
      res.status(StatusCode.BAD_REQUEST).json({ message: error.message });
      return;
    }
    res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
