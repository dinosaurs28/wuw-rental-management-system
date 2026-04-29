import { prisma, DamageChargeType, DamageReport } from "@repo/database/client";
import { createID } from "../../utils/nanoID.js";

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
      };
    }

    // Penalty is taxable
    const gstRule = await prisma.gSTRule.findUnique({
      where: { branchId },
    });

    const cgstRate = gstRule ? Number(gstRule.cgstRate) : 9;
    const sgstRate = gstRule ? Number(gstRule.sgstRate) : 9;
    const igstRate = gstRule ? Number(gstRule.igstRate) : 0;
    
    // In India, usually intra-state applies CGST+SGST = 18% total.
    const totalTaxRate = cgstRate + sgstRate + igstRate;
    const taxAmount = amount * (totalTaxRate / 100);

    return {
      isTaxable: true,
      taxAmount: taxAmount,
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
    taxAmount: number
  ) {
    const isTaxable = chargeType === "PENALTY";
    const chargeEnum = isTaxable ? "DAMAGE_PENALTY" : "DAMAGE_COMPENSATION";

    // 1. Create the Invoice Item
    const invoiceItem = await tx.invoiceItem.create({
      data: {
        publicId: createID(),
        invoiceId,
        label,
        amount,
        isTaxable,
        chargeType: chargeEnum,
      },
    });

    // 2. Update the Invoice totals and invalidate cached PDF
    const finalAmountInclTax = amount + taxAmount;

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        damageCharges: { increment: amount },
        tax: { increment: taxAmount },
        total: { increment: finalAmountInclTax },
        invoicePdfFileId: null,
        generatedAt: null,
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
