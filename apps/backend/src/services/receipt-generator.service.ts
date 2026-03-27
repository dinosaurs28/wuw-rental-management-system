import { prisma } from "@repo/database/client";
import { generateReceiptNumber } from "./receipt-number-generator.js";
import { generateReceiptPDF, ReceiptData, ReceiptLineItem } from "./receipt-pdf-generator.js";
import { uploadReceiptPDFToR2 } from "./r2-upload.js";
import { createID } from "../utils/nanoID.js";
import Decimal from "decimal.js";

interface ChargeResult {
  chargeType: string;
  label: string;
  finalAmount: Decimal;
  skip?: boolean;
}

interface SettlementOutcomeInput {
  totalCharges: Decimal;
  depositPaid: Decimal;
  amountDue: Decimal;
  refundAmount: Decimal;
  charges: ChargeResult[];
}

/**
 * Creates a ReturnReceipt record and generates its PDF after settlement is confirmed.
 * Runs outside any DB transaction — call this after ConfirmSettlement succeeds.
 */
export async function generateReturnReceipt(
  bookingId: number,
  outcome: SettlementOutcomeInput,
): Promise<void> {
  try {
    console.log(`[Receipt Generator] Starting for booking ${bookingId}`);

    // Build line items from charge breakdown
    const lineItems: ReceiptLineItem[] = outcome.charges
      .filter((c) => !c.skip && c.finalAmount.gt(0))
      .map((c) => ({
        label: c.label,
        amount: Number(c.finalAmount.toFixed(2)),
        chargeType: c.chargeType,
      }));

    const receiptNumber = generateReceiptNumber(bookingId);

    // Create the ReturnReceipt record (idempotent: skip if already exists)
    const existing = await prisma.returnReceipt.findUnique({ where: { bookingId } });
    if (existing) {
      console.log(`[Receipt Generator] Receipt already exists for booking ${bookingId}`);
      return;
    }

    const receipt = await prisma.returnReceipt.create({
      data: {
        publicId: createID(),
        bookingId,
        receiptNumber,
        lineItems: lineItems as any,
        totalCharges: outcome.totalCharges.toFixed(2),
        depositPaid: outcome.depositPaid.toFixed(2),
        amountDue: outcome.amountDue.toFixed(2),
        refundAmount: outcome.refundAmount.toFixed(2),
      },
    });

    console.log(`[Receipt Generator] Receipt record created: ${receipt.id}`);

    // Fetch booking details for PDF
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        customer: { include: { user: true } },
        branch: { include: { gstRule: true } },
      },
    });

    if (!booking) {
      console.error(`[Receipt Generator] Booking ${bookingId} not found for PDF`);
      return;
    }

    const receiptData: ReceiptData = {
      receiptNumber,
      receiptDate: new Date(),
      companyName: booking.branch.name,
      companyAddress: booking.branch.address ?? "N/A",
      companyPhone: booking.branch.phone ?? process.env.COMPANY_PHONE ?? "N/A",
      companyEmail: process.env.COMPANY_EMAIL ?? "info@company.com",
      gstNumber: booking.branch.gstRule?.gstNumber ?? "N/A",
      customerName: booking.customer.user?.name ?? "Guest",
      customerEmail: booking.customer.user?.email ?? "N/A",
      customerPhone:
        booking.customer.user?.phone ?? booking.customer.alternatePhone ?? "N/A",
      bookingPublicId: booking.publicId,
      startDate: booking.startAt,
      endDate: booking.endAt,
      days: booking.days,
      lineItems,
      totalCharges: Number(outcome.totalCharges.toFixed(2)),
      depositPaid: Number(outcome.depositPaid.toFixed(2)),
      amountDue: Number(outcome.amountDue.toFixed(2)),
      refundAmount: Number(outcome.refundAmount.toFixed(2)),
    };

    const pdfBuffer = await generateReceiptPDF(receiptData);
    const upload = await uploadReceiptPDFToR2(pdfBuffer, receiptNumber, bookingId);

    await prisma.returnReceipt.update({
      where: { id: receipt.id },
      data: {
        receiptPdfFileId: upload.fileId,
        generatedAt: new Date(),
      },
    });

    console.log(`[Receipt Generator] Receipt PDF ready: ${upload.url}`);
  } catch (error) {
    // Non-fatal — settlement is already confirmed; log and continue
    console.error(`[Receipt Generator] Failed to generate receipt for booking ${bookingId}:`, error);
  }
}
