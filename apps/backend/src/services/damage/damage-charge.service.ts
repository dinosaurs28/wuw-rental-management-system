import { prisma, DamageChargeType, DamageReport } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { computeInvoiceGstTotals, INVOICE_SOURCE } from "../invoice-totals.service.js";

export class DamageChargeService {
  /**
   * The tax on a damage charge. Damage is a recovery charge billed at face value
   * with NO GST — compensation and a penalty alike (item 8, Oct 3 2026; a
   * PENALTY used to carry CGST + SGST). Kept async with the same shape for callers.
   */
  async calculateDamageTax(
    _amount: number,
    _chargeType: DamageChargeType,
    _branchId: number
  ) {
    return {
      isTaxable: false,
      taxAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
    };
  }

  /**
   * Add a damage charge to an existing invoice as an InvoiceItem.
   * Modifies the invoice totals including calculated tax.
   */
  async addDamageChargeToInvoice(
    tx: any,
    invoiceId: number,
    amount: number,
    chargeType: DamageChargeType,
    label: string,
    taxAmount: number,
    damageReportPublicId?: string,
  ) {
    // No GST on damage (item 8): the line is non-taxable whatever its type
    const isTaxable = false;
    const chargeEnum = chargeType === "PENALTY" ? "DAMAGE_PENALTY" : "DAMAGE_COMPENSATION";

    // 1. Create the Invoice Item — its GST is stored on the line, and the
    // DAMAGE_REVIEW source keeps it through a later invoice finalization.
    const invoiceItem = await tx.invoiceItem.create({
      data: {
        publicId: createID(),
        invoiceId,
        label,
        amount,
        isTaxable,
        chargeType: chargeEnum,
        taxAmount: isTaxable ? taxAmount.toFixed(2) : "0.00",
        sourceRef: damageReportPublicId ? `${INVOICE_SOURCE.DAMAGE_REVIEW}${damageReportPublicId}` : null,
      },
    });

    // 2. Update the Invoice totals and invalidate cached PDF
    const finalAmountInclTax = amount + taxAmount;

    const invoice = await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        damageCharges: { increment: amount },
        total: { increment: finalAmountInclTax },
        invoicePdfFileId: null,
        generatedAt: null,
      },
      select: { bookingId: true },
    });

    // GST columns re-read from the stored lines (rental + extensions + this one)
    const totals = await computeInvoiceGstTotals(invoice.bookingId, tx);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        tax: totals.tax.toFixed(2),
        taxableAmount: totals.taxableAmount.toFixed(2),
        cgstAmount: totals.cgstAmount.toFixed(2),
        sgstAmount: totals.sgstAmount.toFixed(2),
        depositAmount: totals.depositAmount.toFixed(2),
      },
    });

    return {
      invoiceItem,
      finalAmountInclTax,
    };
  }

  /**
   * Updates the charge type of an existing damage report.
   */
  async updateDamageChargeType(
    damageReportId: number,
    chargeType: DamageChargeType
  ): Promise<DamageReport> {
    return await prisma.damageReport.update({
      where: { id: damageReportId },
      data: {
        chargeType,
      },
    });
  }
}

export const damageChargeService = new DamageChargeService();
