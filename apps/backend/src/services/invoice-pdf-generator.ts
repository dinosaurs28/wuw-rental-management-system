import PDFDocument from "pdfkit";
import type { InvoiceData, InvoiceSection } from "./invoice-data-transformer.js";
import {
  PDFRenderContext,
  C,
  drawFullPageHeader,
  drawPageLabel,
  drawSectionHeader,
  drawRentalTableHeader,
  drawRentalTableRow,
  drawExtensionTableHeader,
  drawExtensionTableRow,
  drawSimpleTableHeader,
  drawSimpleTableRow,
  drawSectionTotals,
  drawPageSubtotalBar,
  drawSummaryTable,
  drawAllFooters,
} from "./invoice-pdf-helpers.js";

// ─── Section renderers ─────────────────────────────────────────────────────────

/** CGST/SGST row labels with the section's frozen rate ("CGST" alone when lines mix rates). */
function taxLabels(ctx: PDFRenderContext, section: InvoiceSection): { cgstLabel: string; sgstLabel: string } {
  const cgst = section.cgstRate === undefined ? ctx.invoiceData.cgstRate : section.cgstRate;
  const sgst = section.sgstRate === undefined ? ctx.invoiceData.sgstRate : section.sgstRate;
  return {
    cgstLabel: cgst != null ? `CGST (${cgst}%)` : "CGST",
    sgstLabel: sgst != null ? `SGST (${sgst}%)` : "SGST",
  };
}

/** Renders the Vehicle Rental section (multi-column table with Days/Rate/Discount). */
function renderVehicleRentalSection(
  ctx: PDFRenderContext,
  section: InvoiceSection,
  letter: string,
): void {
  const { cgstLabel, sgstLabel } = taxLabels(ctx, section);

  drawSectionHeader(ctx, `${letter}  Vehicle Rental`, C.taxable, C.taxableAccent);
  drawRentalTableHeader(ctx);

  for (const item of section.items) {
    drawRentalTableRow(ctx, item);
  }

  drawSectionTotals(ctx, section, cgstLabel, sgstLabel);
}

/** Renders the Extension Charges section (3-column: Description / Extra Time / Amount). */
function renderExtensionChargesSection(
  ctx: PDFRenderContext,
  section: InvoiceSection,
  letter: string,
): void {
  const { cgstLabel, sgstLabel } = taxLabels(ctx, section);

  drawSectionHeader(
    ctx,
    `${letter}  Rental Extension Charges`,
    C.taxable,
    C.taxableAccent,
    "GST applicable",
  );
  drawExtensionTableHeader(ctx);

  for (const item of section.items) {
    drawExtensionTableRow(ctx, item);
  }

  drawSectionTotals(ctx, section, cgstLabel, sgstLabel);
}

/**
 * Renders return charges stored with GST (bills computed before item 8 — new
 * drop charges carry no GST and print under Additional Return Charges).
 */
function renderTaxableReturnChargesSection(
  ctx: PDFRenderContext,
  section: InvoiceSection,
  letter: string,
): void {
  const { cgstLabel, sgstLabel } = taxLabels(ctx, section);

  drawSectionHeader(
    ctx,
    `${letter}  Return Charges`,
    C.taxable,
    C.taxableAccent,
    "GST applicable",
  );
  drawSimpleTableHeader(ctx, "Amount (before GST)");

  for (const item of section.items) {
    drawSimpleTableRow(ctx, item.description, item.amount);
  }

  drawSectionTotals(ctx, section, cgstLabel, sgstLabel);
}

/** Renders the Damage Penalty section. */
function renderDamagePenaltySection(
  ctx: PDFRenderContext,
  section: InvoiceSection,
  letter: string,
): void {
  const { cgstLabel, sgstLabel } = taxLabels(ctx, section);

  drawSectionHeader(
    ctx,
    `${letter}  Damage Penalty`,
    C.penalty,
    C.penaltyAccent,
    "GST applicable",
  );
  drawSimpleTableHeader(ctx, "Base Amount");

  for (const item of section.items) {
    drawSimpleTableRow(ctx, item.description, item.amount);
  }

  drawSectionTotals(ctx, section, cgstLabel, sgstLabel);
}

/** Renders Additional Return Charges section. */
function renderAdditionalChargesSection(
  ctx: PDFRenderContext,
  section: InvoiceSection,
  sectionLabel: string,
): void {
  drawSectionHeader(
    ctx,
    `${sectionLabel}  Additional Return Charges`,
    C.nonTaxable,
    C.nonTaxableAccent,
    "Non-taxable",
  );
  drawSimpleTableHeader(ctx, "Amount");

  for (const item of section.items) {
    drawSimpleTableRow(ctx, item.description, item.amount);
  }

  // Non-taxable lines (drop / recovery charges since item 8, FASTag/tolls, grace) — no GST rows
  const zeroedSection = { ...section, cgst: 0, sgst: 0, taxTotal: 0 };
  drawSectionTotals(ctx, zeroedSection, "", "");
}

/** Renders Damage Compensation section. */
function renderDamageCompensationSection(
  ctx: PDFRenderContext,
  section: InvoiceSection,
  sectionLabel: string,
): void {
  drawSectionHeader(
    ctx,
    `${sectionLabel}  Damage Charges`,
    C.compensation,
    C.compensationAccent,
    "Non-taxable",
  );
  drawSimpleTableHeader(ctx, "Amount");

  for (const item of section.items) {
    drawSimpleTableRow(ctx, item.description, item.amount, "No GST applicable");
  }

  // Compensation has no GST — pass zeroed section for display
  const zeroedSection = { ...section, cgst: 0, sgst: 0, taxTotal: 0 };
  drawSectionTotals(ctx, zeroedSection, "", "");
}

// ─── Main generator ────────────────────────────────────────────────────────────

/**
 * Generates a multi-section, GST-compliant PDF invoice.
 *
 * Layout:
 *   Page 1 — Header + Taxable section (Vehicle Rental + Damage Penalty)
 *   Page 2 — Non-Taxable section (Additional Charges + Damage Compensation) [omitted if empty]
 *   Page 3 — Invoice Summary with grand total and payment info
 */
export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      console.log(`[Invoice PDF Generator] Generating PDF for ${invoiceData.invoiceNumber}`);

      const doc = new PDFDocument({
        margin: 50,
        size: "A4",
        bufferPages: true, // required for retroactive footer rendering
        autoFirstPage: false,
      });

      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const ctx = new PDFRenderContext(doc, invoiceData);

      // ──────────────────────────────────────────────────────────────────────────
      // PAGE 1 — TAXABLE CHARGES
      // ──────────────────────────────────────────────────────────────────────────
      doc.addPage();
      ctx.pageIndices.push(0);
      ctx.y = 50;

      drawFullPageHeader(ctx);

      drawPageLabel(ctx, "TAXABLE CHARGES", C.taxableAccent);

      let taxableTotal = 0;

      invoiceData.taxableSections.forEach((section, idx) => {
        const letter = String.fromCharCode(65 + idx) + ".";
        if (section.type === "VEHICLE_RENTAL") {
          renderVehicleRentalSection(ctx, section, letter);
        } else if (section.type === "EXTENSION_CHARGES") {
          renderExtensionChargesSection(ctx, section, letter);
        } else if (section.type === "TAXABLE_RETURN_CHARGES") {
          renderTaxableReturnChargesSection(ctx, section, letter);
        } else if (section.type === "DAMAGE_PENALTY") {
          renderDamagePenaltySection(ctx, section, letter);
        }
        taxableTotal += section.sectionTotal;
      });

      drawPageSubtotalBar(
        ctx,
        "Taxable Total",
        taxableTotal,
        C.taxable,
        C.taxableAccent,
      );

      // ──────────────────────────────────────────────────────────────────────────
      // PAGE 2 — NON-TAXABLE CHARGES (conditional)
      // ──────────────────────────────────────────────────────────────────────────
      if (invoiceData.nonTaxableSections.length > 0) {
        ctx.addPage(); // adds page + compact header

        drawPageLabel(ctx, "ADDITIONAL & NON-TAXABLE CHARGES", C.nonTaxableAccent);

        let nonTaxableTotal = 0;
        let nonTaxableSectionIndex = 0;

        for (const section of invoiceData.nonTaxableSections) {
          const sectionLabel = String.fromCharCode(65 + nonTaxableSectionIndex) + ".";

          if (section.type === "ADDITIONAL_CHARGES") {
            renderAdditionalChargesSection(ctx, section, sectionLabel);
          } else if (section.type === "DAMAGE_COMPENSATION") {
            renderDamageCompensationSection(ctx, section, sectionLabel);
          }

          nonTaxableTotal += section.sectionTotal;
          nonTaxableSectionIndex++;
        }

        drawPageSubtotalBar(
          ctx,
          "Additional Charges Total",
          nonTaxableTotal,
          C.nonTaxable,
          C.nonTaxableAccent,
        );
      }

      // ──────────────────────────────────────────────────────────────────────────
      // PAGE 3 — SUMMARY
      // ──────────────────────────────────────────────────────────────────────────
      ctx.addPage(); // adds page + compact header

      drawPageLabel(ctx, "INVOICE SUMMARY", C.summaryAccent);

      drawSummaryTable(ctx);

      // ──────────────────────────────────────────────────────────────────────────
      // RETROACTIVE FOOTERS — requires bufferPages: true
      // ──────────────────────────────────────────────────────────────────────────
      const totalPages = doc.bufferedPageRange().count;
      drawAllFooters(doc, invoiceData, totalPages);

      doc.end();

      console.log(
        `[Invoice PDF Generator] ✅ PDF generated for ${invoiceData.invoiceNumber} ` +
          `(${totalPages} page${totalPages !== 1 ? "s" : ""})`,
      );
    } catch (error) {
      console.error("[Invoice PDF Generator] Error:", error);
      reject(error);
    }
  });
}
