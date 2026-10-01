import { prisma } from "@repo/database/client";
import { generateReceiptNumber } from "./receipt-number-generator.js";
import { generateReceiptPDF, ReceiptData, ReceiptLineItem } from "./receipt-pdf-generator.js";
import { uploadReceiptPDFToR2 } from "./r2-upload.js";
import { createID } from "../utils/nanoID.js";
import { displayEmail } from "../utils/customer/identity.js";
import { chargeEntryGst } from "./charges/legacy-return-charges.service.js";
import Decimal from "decimal.js";

interface ChargeResult {
  chargeType: string;
  label: string;
  finalAmount: Decimal;
  skip?: boolean;
  /** GST a legacy drop froze on the ChargeEntry (columns; older rows: JSON in notes) */
  gstAmount?: Decimal;
  cgstAmount?: Decimal;
  sgstAmount?: Decimal;
  taxRate?: Decimal;
  notes?: string;
}

/**
 * GST frozen on the charge lines when they were written (canonical rule #23):
 * a legacy drop stores it on the ChargeEntry; nothing is re-taxed here, and a
 * line without stored GST is not taxed.
 */
export function frozenChargeGst(charges: ChargeResult[]): { cgst: Decimal; sgst: Decimal; gst: Decimal } {
  let cgst = new Decimal(0);
  let sgst = new Decimal(0);
  for (const c of charges) {
    if (c.skip || c.finalAmount.lte(0)) continue;
    const g = chargeEntryGst(c);
    if (!g) continue;
    cgst = cgst.add(g.cgst);
    sgst = sgst.add(g.sgst);
  }
  return { cgst, sgst, gst: cgst.add(sgst) };
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

    // Build line items from charge breakdown — amount before GST, with the GST
    // frozen on the line (taxable lines only)
    const lineItems: ReceiptLineItem[] = outcome.charges
      .filter((c) => !c.skip && c.finalAmount.gt(0))
      .map((c) => {
        const g = chargeEntryGst(c);
        const taxable = !!g && g.gst.gt(0);
        return {
          label: c.label,
          amount: Number(c.finalAmount.toFixed(2)),
          chargeType: c.chargeType,
          isTaxable: taxable,
          cgstAmount: taxable ? Number(g!.cgst.toFixed(2)) : 0,
          sgstAmount: taxable ? Number(g!.sgst.toFixed(2)) : 0,
        };
      });
    const lineGst = frozenChargeGst(outcome.charges);
    const taxableValue = lineItems.filter((l) => l.isTaxable).reduce((s, l) => s + l.amount, 0);

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
      // Walk-in placeholder / tombstone emails are never printed (#1).
      customerEmail: displayEmail(booking.customer.user?.email) ?? "N/A",
      customerPhone:
        booking.customer.user?.phone ?? booking.customer.alternatePhone ?? "N/A",
      bookingPublicId: booking.publicId,
      startDate: booking.startAt,
      endDate: booking.endAt,
      days: booking.days,
      lineItems,
      taxableValue: Math.round(taxableValue * 100) / 100,
      cgstAmount: Number(lineGst.cgst.toFixed(2)),
      sgstAmount: Number(lineGst.sgst.toFixed(2)),
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
