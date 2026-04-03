import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { randomUUID } from "crypto";

/**
 * POST /api/manager/credit-notes
 * Issue a credit note against a booking's invoice or return receipt.
 */
export const IssueCreditNote = async (req: Request, res: Response) => {
  try {
    const actorPublicId = req.public_Id;
    if (!actorPublicId) {
      return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    }

    const { bookingPublicId, invoicePublicId, receiptPublicId, amount, reason } = req.body;

    if (!bookingPublicId || !amount || !reason) {
      return res.status(StatusCode.BAD_REQUEST).json({
        message: "bookingPublicId, amount and reason are required",
      });
    }

    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(StatusCode.BAD_REQUEST).json({ message: "amount must be a positive number" });
    }

    const [actor, booking] = await Promise.all([
      prisma.user.findUnique({ where: { publicId: actorPublicId }, select: { id: true } }),
      prisma.booking.findUnique({
        where: { publicId: bookingPublicId },
        select: { id: true, publicId: true, invoice: { select: { id: true, publicId: true } }, returnReceipt: { select: { id: true, publicId: true } } },
      }),
    ]);

    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });

    // Resolve optional references
    let invoiceId: number | undefined;
    if (invoicePublicId) {
      const inv = await prisma.invoice.findUnique({ where: { publicId: invoicePublicId }, select: { id: true } });
      if (!inv) return res.status(StatusCode.NOT_FOUND).json({ message: "Invoice not found" });
      invoiceId = inv.id;
    } else if (booking.invoice) {
      invoiceId = booking.invoice.id;
    }

    let receiptId: number | undefined;
    if (receiptPublicId) {
      const rcp = await prisma.returnReceipt.findUnique({ where: { publicId: receiptPublicId }, select: { id: true } });
      if (!rcp) return res.status(StatusCode.NOT_FOUND).json({ message: "Receipt not found" });
      receiptId = rcp.id;
    } else if (booking.returnReceipt) {
      receiptId = booking.returnReceipt.id;
    }

    // Generate credit note number: CN-YYYYMMDD-<random 4 chars>
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    const creditNoteNumber = `CN-${datePart}-${suffix}`;

    const creditNote = await prisma.creditNote.create({
      data: {
        publicId: randomUUID(),
        creditNoteNumber,
        bookingId: booking.id,
        invoiceId,
        receiptId,
        amount: amountNum,
        reason,
        status: "APPROVED",
        issuedById: actor.id,
      },
      include: {
        booking: { select: { publicId: true } },
        invoice: { select: { publicId: true, invoiceNumber: true } },
        receipt: { select: { publicId: true, receiptNumber: true } },
        issuedBy: { select: { name: true } },
      },
    });

    return res.status(StatusCode.CREATED).json({
      message: "Credit note issued successfully",
      data: {
        publicId: creditNote.publicId,
        creditNoteNumber: creditNote.creditNoteNumber,
        bookingId: creditNote.booking.publicId,
        invoiceRef: creditNote.invoice
          ? { publicId: creditNote.invoice.publicId, invoiceNumber: creditNote.invoice.invoiceNumber }
          : null,
        receiptRef: creditNote.receipt
          ? { publicId: creditNote.receipt.publicId, receiptNumber: creditNote.receipt.receiptNumber }
          : null,
        amount: Number(creditNote.amount),
        reason: creditNote.reason,
        status: creditNote.status,
        issuedBy: creditNote.issuedBy.name,
        createdAt: creditNote.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[CreditNote] IssueCreditNote error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};

/**
 * GET /api/manager/credit-notes/:bookingPublicId
 * List all credit notes for a booking.
 */
export const GetBookingCreditNotes = async (req: Request, res: Response) => {
  try {
    const { bookingPublicId } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { publicId: bookingPublicId },
      select: { id: true },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ message: "Booking not found" });
    }

    const creditNotes = await prisma.creditNote.findMany({
      where: { bookingId: booking.id },
      include: {
        invoice: { select: { publicId: true, invoiceNumber: true } },
        receipt: { select: { publicId: true, receiptNumber: true } },
        issuedBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(StatusCode.OK).json({
      message: "Credit notes fetched successfully",
      data: creditNotes.map((cn) => ({
        publicId: cn.publicId,
        creditNoteNumber: cn.creditNoteNumber,
        invoiceRef: cn.invoice
          ? { publicId: cn.invoice.publicId, invoiceNumber: cn.invoice.invoiceNumber }
          : null,
        receiptRef: cn.receipt
          ? { publicId: cn.receipt.publicId, receiptNumber: cn.receipt.receiptNumber }
          : null,
        amount: Number(cn.amount),
        reason: cn.reason,
        status: cn.status,
        issuedBy: cn.issuedBy.name,
        createdAt: cn.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[CreditNote] GetBookingCreditNotes error:", error);
    return res.status(StatusCode.INTERNAL_SERVER_ERROR).json({ message: "Internal server error" });
  }
};
