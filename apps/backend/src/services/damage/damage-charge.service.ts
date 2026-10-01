import { prisma, DamageChargeType, DamageReport } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";
import { getBranchGstRates, computeLineGst } from "../tax/gst.service.js";
import { computeInvoiceGstTotals, INVOICE_SOURCE } from "../invoice-totals.service.js";

export class DamageChargeService {
  /**
   * Calculate the tax amount for a specific damage charge based on the branch's GST rule.
   */
  async calculateDamageTax(
    amount: number,
    chargeType: DamageChargeType,
    branchId: number
  ) {
    // Compensation is not taxable
    if (chargeType === "COMPENSATION") {
      return {
        isTaxable: false,
        taxAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
      };
    }

    // A penalty the manager marked in review is taxable: CGST + SGST only (an
    // intra-state supply — IGST is never added), each rounded half-up to 2 dp.
    // A branch without a GST rule fails with GST_RULE_MISSING.
    const rates = await getBranchGstRates(branchId);
    const gst = computeLineGst(amount, rates);

    return {
      isTaxable: true,
      taxAmount: gst.gst.toNumber(),
      cgstAmount: gst.cgst.toNumber(),
      sgstAmount: gst.sgst.toNumber(),
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
    const isTaxable = chargeType === "PENALTY";
    const chargeEnum = isTaxable ? "DAMAGE_PENALTY" : "DAMAGE_COMPENSATION";

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
