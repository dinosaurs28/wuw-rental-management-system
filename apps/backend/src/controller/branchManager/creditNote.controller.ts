import { Request, Response } from "express";
import { prisma } from "@repo/database/client";
import { StatusCode } from "../../types/statusCode.js";
import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import {
  isGstRuleMissing,
  GST_RULE_MISSING,
  GST_RULE_MISSING_MESSAGE,
} from "../../services/tax/gst.service.js";
import { bookingGstRates, computeInvoiceGstTotals } from "../../services/invoice-totals.service.js";

const ZERO = new Decimal(0);

/**
 * GST inside a credit note. The credit is GST-inclusive and reverses the
 * invoice's taxable supply first; whatever exceeds the taxable value + GST still
 * uncredited on the invoice is a non-taxable refund (deposit, FASTag,
 * compensation, drop charges — they carry no GST since item 8). Without an
 * invoice there is no taxable supply to reverse.
 *
 * The taxable part is split in the invoice's own taxable : GST proportion, so a
 * full credit reverses exactly what was charged whichever way the GST was
 * worked out — GST-inclusive rent (item 17: ₹1,300 = ₹1,066 + ₹234) or a GST
 * added on top (older bookings: ₹1,180 = ₹1,000 + ₹180). CGST/SGST follow the
 * booking's frozen rates.
 */
async function creditNoteGstSplit(bookingId: number, invoiceId: number | undefined, amount: number) {
  if (!invoiceId) return { taxable: ZERO, cgst: ZERO, sgst: ZERO };

  const totals = await computeInvoiceGstTotals(bookingId);
  const taxableGross = totals.taxableAmount.add(totals.tax);
  const earlier = await prisma.creditNote.aggregate({
    where: { invoiceId, status: "APPROVED" },
    _sum: { taxableAmount: true, cgstAmount: true, sgstAmount: true },
  });
  const earlierTaxable = new Decimal(String(earlier._sum.taxableAmount ?? 0));
  const earlierGst = new Decimal(String(earlier._sum.cgstAmount ?? 0)).add(String(earlier._sum.sgstAmount ?? 0));
  const alreadyCredited = earlierTaxable.add(earlierGst);
  const room = Decimal.max(ZERO, taxableGross.sub(alreadyCredited));
  const gstPortion = Decimal.min(new Decimal(amount), room);
  if (gstPortion.lte(0)) return { taxable: ZERO, cgst: ZERO, sgst: ZERO };

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { branchId: true, pricingSnapshot: true, items: { select: { taxRate: true } } },
  });
  const rates = await bookingGstRates(booking);

  // GST share of the reversed part: the rest of the invoice GST when the credit
  // takes all that is left, else in the invoice's proportion (half-up to paise)
  const gstLeft = Decimal.max(ZERO, totals.tax.sub(earlierGst));
  const gst = gstPortion.eq(room)
    ? Decimal.min(gstLeft, gstPortion)
    : Decimal.min(
        gstLeft,
        taxableGross.gt(0)
          ? gstPortion.mul(totals.tax).div(taxableGross).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          : ZERO,
      );
  const cgst = rates.rate > 0
    ? gst.mul(rates.cgstRate).div(rates.rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    : ZERO;
  return { taxable: gstPortion.sub(gst), cgst, sgst: gst.sub(cgst) };
}

/** Credit-note GST fields for responses (numbers, like `amount`). */
function creditNoteGstView(cn: {
  amount: { toString(): string };
  taxableAmount: { toString(): string };
  cgstAmount: { toString(): string };
  sgstAmount: { toString(): string };
}) {
  const taxable = Number(cn.taxableAmount);
  const cgst = Number(cn.cgstAmount);
  const sgst = Number(cn.sgstAmount);
  return {
    taxableAmount: taxable,
    cgstAmount: cgst,
    sgstAmount: sgst,
    taxAmount: Math.round((cgst + sgst) * 100) / 100,
    // Part of the credit outside the taxable supply (deposit, FASTag, compensation)
    nonTaxableAmount: Math.round((Number(cn.amount) - taxable - cgst - sgst) * 100) / 100,
  };
}

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

    const branchId = req.branch_Id;
    if (!branchId) {
      return res.status(StatusCode.FORBIDDEN).json({ success: false, code: "BRANCH_REQUIRED", message: "Your account is not linked to a branch." });
    }

    const [actor, booking] = await Promise.all([
      prisma.user.findUnique({ where: { publicId: actorPublicId }, select: { id: true } }),
      // Only this manager's branch: a credit note is a statutory document of the issuing branch
      prisma.booking.findFirst({
        where: { publicId: bookingPublicId, branchId },
        select: { id: true, publicId: true, invoice: { select: { id: true, publicId: true } }, returnReceipt: { select: { id: true, publicId: true } } },
      }),
    ]);

    if (!actor) return res.status(StatusCode.UNAUTHORIZED).json({ message: "Unauthorized" });
    if (!booking) return res.status(StatusCode.NOT_FOUND).json({ success: false, code: "BOOKING_NOT_FOUND", message: "Booking not found" });

    // Resolve optional references — they must belong to this booking, otherwise the GST
    // reversal would be measured against another invoice's credit history.
    let invoiceId: number | undefined;
    if (invoicePublicId) {
      const inv = await prisma.invoice.findUnique({ where: { publicId: invoicePublicId }, select: { id: true, bookingId: true } });
      if (!inv || inv.bookingId !== booking.id) {
        return res.status(StatusCode.NOT_FOUND).json({ success: false, code: "INVOICE_NOT_FOUND", message: "Invoice not found for this booking" });
      }
      invoiceId = inv.id;
    } else if (booking.invoice) {
      invoiceId = booking.invoice.id;
    }

    let receiptId: number | undefined;
    if (receiptPublicId) {
      const rcp = await prisma.returnReceipt.findUnique({ where: { publicId: receiptPublicId }, select: { id: true, bookingId: true } });
      if (!rcp || rcp.bookingId !== booking.id) {
        return res.status(StatusCode.NOT_FOUND).json({ success: false, code: "RECEIPT_NOT_FOUND", message: "Receipt not found for this booking" });
      }
      receiptId = rcp.id;
    } else if (booking.returnReceipt) {
      receiptId = booking.returnReceipt.id;
    }

    // Generate credit note number: CN-YYYYMMDD-<random 4 chars>
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const suffix = randomUUID().slice(0, 4).toUpperCase();
    const creditNoteNumber = `CN-${datePart}-${suffix}`;

    // GST reversed by the credit note (canonical rule #23: CGST + SGST, rounded per tax)
    let gstSplit: Awaited<ReturnType<typeof creditNoteGstSplit>>;
    try {
      gstSplit = await creditNoteGstSplit(booking.id, invoiceId, amountNum);
    } catch (err) {
      if (isGstRuleMissing(err)) {
        return res.status(StatusCode.CONFLICT).json({ success: false, code: GST_RULE_MISSING, message: GST_RULE_MISSING_MESSAGE });
      }
      throw err;
    }

    const creditNote = await prisma.creditNote.create({
      data: {
        publicId: randomUUID(),
        creditNoteNumber,
        bookingId: booking.id,
        invoiceId,
        receiptId,
        amount: amountNum,
        taxableAmount: gstSplit.taxable.toFixed(2),
        cgstAmount: gstSplit.cgst.toFixed(2),
        sgstAmount: gstSplit.sgst.toFixed(2),
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
        ...creditNoteGstView(creditNote),
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
    const branchId = req.branch_Id;
    if (!branchId) {
      return res.status(StatusCode.FORBIDDEN).json({ success: false, code: "BRANCH_REQUIRED", message: "Your account is not linked to a branch." });
    }

    const booking = await prisma.booking.findFirst({
      where: { publicId: bookingPublicId, branchId },
      select: { id: true },
    });

    if (!booking) {
      return res.status(StatusCode.NOT_FOUND).json({ success: false, code: "BOOKING_NOT_FOUND", message: "Booking not found" });
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
        ...creditNoteGstView(cn),
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
