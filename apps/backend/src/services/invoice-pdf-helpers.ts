import PDFDocument from "pdfkit";
import type { InvoiceData, InvoiceSection } from "./invoice-data-transformer.js";

// ─── Page constants ────────────────────────────────────────────────────────────

export const L = 50;           // left margin
export const R = 545;          // right edge
export const W = R - L;        // usable width = 495
export const PAGE_BOTTOM = 720; // Y threshold before adding a new page (footer zone starts at ~752)

// ─── Color palette ─────────────────────────────────────────────────────────────

export const C = {
  black: "#1A1A1A",
  gray: "#6B7280",
  lightGray: "#9CA3AF",
  border: "#E5E7EB",
  pageBg: "#F9FAFB",
  accent: "#FF5F00",
  taxable: "#FFF7ED",       // orange-50
  taxableAccent: "#C2410C", // orange-700
  nonTaxable: "#EFF6FF",    // blue-50
  nonTaxableAccent: "#1D4ED8", // blue-700
  summary: "#F0FDF4",       // green-50
  summaryAccent: "#15803D", // green-700
  penalty: "#FEF2F2",       // red-50
  penaltyAccent: "#B91C1C", // red-700
  compensation: "#F0F9FF",  // sky-50
  compensationAccent: "#0369A1", // sky-700
} as const;

// ─── Column layouts ────────────────────────────────────────────────────────────

// Rental table: Description | Days | Rate | Discount | Amount
export const RENTAL_COLS = {
  desc:     { x: L,   w: 230 },
  days:     { x: 280, w: 40  },
  rate:     { x: 320, w: 70  },
  discount: { x: 390, w: 65  },
  amount:   { x: 455, w: 90  },
};

// Simple table (additional/damage): Description | Amount
export const SIMPLE_COLS = {
  desc:   { x: L,   w: 370 },
  amount: { x: 420, w: 125 },
};

// Extension table: Description | Extra Days | Amount
export const EXTENSION_COLS = {
  desc:   { x: L,   w: 320 },
  days:   { x: 370, w: 75  },
  amount: { x: 455, w: 90  },
};

// ─── Render context ────────────────────────────────────────────────────────────

export class PDFRenderContext {
  doc: InstanceType<typeof PDFDocument>;
  y: number = 50;
  pageIndices: number[] = [];
  invoiceData: InvoiceData;

  constructor(
    doc: InstanceType<typeof PDFDocument>,
    invoiceData: InvoiceData,
  ) {
    this.doc = doc;
    this.invoiceData = invoiceData;
  }

  /** Add a new page, draw the compact page header, record the page index. */
  addPage(): void {
    this.doc.addPage();
    this.pageIndices.push(this.doc.bufferedPageRange().start + this.pageIndices.length);
    this.y = 50;
    drawCompactPageHeader(this);
  }

  /** True when the next block of `height` pts would overflow the page. */
  willOverflow(height: number): boolean {
    return this.y + height > PAGE_BOTTOM;
  }

  /** Advance the cursor and optionally add a new page if needed. */
  advance(by: number, requiredBelow = 0): void {
    this.y += by;
    if (requiredBelow > 0 && this.willOverflow(requiredBelow)) {
      this.addPage();
    }
  }
}

// ─── Formatting helpers ────────────────────────────────────────────────────────

export function fmt(n: number): string {
  // ₹ (U+20B9) is not in PDFKit's built-in Helvetica WinAnsi encoding and
  // renders as superscript-1. Use the universally-supported "Rs." prefix instead.
  return `Rs.${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ─── Low-level draw primitives ─────────────────────────────────────────────────

export function rule(
  ctx: PDFRenderContext,
  color: string = C.border,
  lineWidth = 0.5,
): void {
  ctx.doc
    .save()
    .strokeColor(color)
    .lineWidth(lineWidth)
    .moveTo(L, ctx.y)
    .lineTo(R, ctx.y)
    .stroke()
    .restore();
}

export function filledRect(
  ctx: PDFRenderContext,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  ctx.doc.save().rect(x, y, width, height).fill(color).restore();
}

/** Right-aligned text in a column. */
function textRight(
  ctx: PDFRenderContext,
  text: string,
  col: { x: number; w: number },
  y: number,
): void {
  ctx.doc.text(text, col.x, y, { width: col.w, align: "right" });
}

// ─── Full page header (first page only) ───────────────────────────────────────

export function drawFullPageHeader(ctx: PDFRenderContext): void {
  const d = ctx.invoiceData;
  const doc = ctx.doc;

  // Title bar
  filledRect(ctx, L, ctx.y, W, 28, C.accent);
  doc
    .font("Helvetica-Bold")
    .fontSize(14)
    .fillColor("#FFFFFF")
    .text("TAX INVOICE", L + 8, ctx.y + 7);
  doc
    .fontSize(9)
    .text(`Invoice No: ${d.invoiceNumber}`, L, ctx.y + 8, {
      width: W - 8,
      align: "right",
    });

  ctx.advance(36);

  // Company (left) | Invoice details (right)
  const topY = ctx.y;

  doc.fillColor(C.black).font("Helvetica-Bold").fontSize(10).text(d.companyName, L, topY);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(C.gray)
    .text(d.companyAddress, L, topY + 14, { width: 240 });
  doc.text(`GSTIN: ${d.gstNumber}`, L, topY + 36);
  doc.text(`Phone: ${d.companyPhone}`, L, topY + 48);
  doc.text(`Email: ${d.companyEmail}`, L, topY + 60);

  doc
    .fillColor(C.black)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("Invoice Date:", 340, topY);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(C.gray)
    .text(fmtDate(d.invoiceDate), 420, topY);

  doc.fillColor(C.black).font("Helvetica-Bold").text("Booking ID:", 340, topY + 16);
  doc.font("Helvetica").fillColor(C.gray).text(d.bookingPublicId, 420, topY + 16);

  doc.fillColor(C.black).font("Helvetica-Bold").text("Status:", 340, topY + 32);
  doc.font("Helvetica").fillColor(C.gray).text(d.paymentStatus, 420, topY + 32);

  ctx.y = topY + 78;
  rule(ctx);
  ctx.advance(10);

  // Customer (left) | Rental Period (right)
  const custY = ctx.y;

  doc.fillColor(C.black).font("Helvetica-Bold").fontSize(8).text("BILL TO", L, custY);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(C.black)
    .text(d.customerName, L, custY + 12);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(C.gray)
    .text(d.customerEmail, L, custY + 26);
  doc.text(d.customerPhone, L, custY + 38);
  doc.text(d.customerAddress, L, custY + 50, { width: 240 });

  doc.fillColor(C.black).font("Helvetica-Bold").fontSize(8).text("RENTAL PERIOD", 340, custY);
  doc
    .font("Helvetica")
    .fontSize(9)
    .fillColor(C.gray)
    .text(`From: ${fmtDate(d.startDate)}`, 340, custY + 12);
  doc.text(`To:     ${fmtDate(d.endDate)}`, 340, custY + 26);
  doc
    .fillColor(C.black)
    .font("Helvetica-Bold")
    .text(`${d.days} day${d.days !== 1 ? "s" : ""}`, 340, custY + 40);

  ctx.y = custY + 72;
  rule(ctx, C.border, 1);
  ctx.advance(14);
}

// ─── Compact page header (subsequent pages) ───────────────────────────────────

export function drawCompactPageHeader(ctx: PDFRenderContext): void {
  const d = ctx.invoiceData;
  const doc = ctx.doc;

  filledRect(ctx, L, ctx.y, W, 22, C.accent);
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#FFFFFF")
    .text(`${d.companyName}  —  TAX INVOICE`, L + 6, ctx.y + 6);
  doc
    .fontSize(8)
    .text(`${d.invoiceNumber}  ·  Booking: ${d.bookingPublicId}`, L, ctx.y + 7, {
      width: W - 6,
      align: "right",
    });

  ctx.advance(28);
  rule(ctx, C.border, 0.5);
  ctx.advance(10);
}

// ─── Section header bar ────────────────────────────────────────────────────────

export function drawSectionHeader(
  ctx: PDFRenderContext,
  label: string,
  bgColor: string,
  textColor: string,
  subLabel?: string,
): void {
  if (ctx.willOverflow(36)) ctx.addPage();

  filledRect(ctx, L, ctx.y, W, 24, bgColor);
  ctx.doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(textColor)
    .text(label, L + 8, ctx.y + 7);

  if (subLabel) {
    ctx.doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(textColor)
      .text(subLabel, L, ctx.y + 8, { width: W - 8, align: "right" });
  }

  ctx.advance(30);
}

// ─── Page-level label ─────────────────────────────────────────────────────────

export function drawPageLabel(
  ctx: PDFRenderContext,
  label: string,
  color: string,
): void {
  ctx.doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(color)
    .text(label, L, ctx.y);
  ctx.advance(18); // clear 13pt text (~16pt line-height) before drawing rule
  rule(ctx, color, 1.5);
  ctx.advance(10);
}

// ─── Rental table ─────────────────────────────────────────────────────────────

export function drawRentalTableHeader(ctx: PDFRenderContext): void {
  if (ctx.willOverflow(28)) ctx.addPage();

  filledRect(ctx, L, ctx.y, W, 20, C.pageBg);
  ctx.doc
    .font("Helvetica-Bold")
    .fontSize(8)
    .fillColor(C.black);

  const y = ctx.y + 6;
  ctx.doc.text("Description", RENTAL_COLS.desc.x, y);
  ctx.doc.text("Days", RENTAL_COLS.days.x, y);
  textRight(ctx, "Rate / Day", RENTAL_COLS.rate, y);
  textRight(ctx, "Discount", RENTAL_COLS.discount, y);
  textRight(ctx, "Amount", RENTAL_COLS.amount, y);

  ctx.advance(20);
  rule(ctx, C.border);
  ctx.advance(4);
}

export function drawRentalTableRow(
  ctx: PDFRenderContext,
  item: {
    description: string;
    quantity?: number;
    unitRate?: number;
    discount?: number;
    amount: number;
  },
): void {
  if (ctx.willOverflow(30)) ctx.addPage();

  const y = ctx.y;
  ctx.doc.font("Helvetica").fontSize(9).fillColor(C.black);

  ctx.doc.text(item.description, RENTAL_COLS.desc.x, y, {
    width: RENTAL_COLS.desc.w,
  });
  ctx.doc.text(String(item.quantity ?? 1), RENTAL_COLS.days.x, y);
  textRight(ctx, fmt(item.unitRate ?? 0), RENTAL_COLS.rate, y);
  textRight(ctx, fmt(item.discount ?? 0), RENTAL_COLS.discount, y);
  textRight(ctx, fmt(item.amount), RENTAL_COLS.amount, y);

  ctx.advance(26);
  rule(ctx, C.border);
  ctx.advance(4);
}

// ─── Extension table (Description | Extra Days | Amount) ──────────────────────

export function drawExtensionTableHeader(ctx: PDFRenderContext): void {
  if (ctx.willOverflow(28)) ctx.addPage();

  filledRect(ctx, L, ctx.y, W, 20, C.pageBg);
  ctx.doc.font("Helvetica-Bold").fontSize(8).fillColor(C.black);

  const y = ctx.y + 6;
  ctx.doc.text("Description", EXTENSION_COLS.desc.x, y, { width: EXTENSION_COLS.desc.w });
  ctx.doc.text("Extra Days", EXTENSION_COLS.days.x, y, { width: EXTENSION_COLS.days.w, align: "center" });
  ctx.doc.text("Amount", EXTENSION_COLS.amount.x, y, { width: EXTENSION_COLS.amount.w, align: "right" });

  ctx.advance(20);
  rule(ctx, C.border);
  ctx.advance(4);
}

export function drawExtensionTableRow(
  ctx: PDFRenderContext,
  item: { description: string; quantity?: number; amount: number },
): void {
  if (ctx.willOverflow(30)) ctx.addPage();

  const y = ctx.y;
  ctx.doc.font("Helvetica").fontSize(9).fillColor(C.black);

  ctx.doc.text(item.description, EXTENSION_COLS.desc.x, y, { width: EXTENSION_COLS.desc.w });
  ctx.doc.text(
    String(item.quantity ?? 1),
    EXTENSION_COLS.days.x,
    y,
    { width: EXTENSION_COLS.days.w, align: "center" },
  );
  ctx.doc.text(
    fmt(item.amount),
    EXTENSION_COLS.amount.x,
    y,
    { width: EXTENSION_COLS.amount.w, align: "right" },
  );

  ctx.advance(26);
  rule(ctx, C.border);
  ctx.advance(4);
}

// ─── Simple (description + amount) table ──────────────────────────────────────

export function drawSimpleTableHeader(
  ctx: PDFRenderContext,
  amountLabel = "Amount",
): void {
  if (ctx.willOverflow(28)) ctx.addPage();

  filledRect(ctx, L, ctx.y, W, 20, C.pageBg);
  ctx.doc.font("Helvetica-Bold").fontSize(8).fillColor(C.black);

  ctx.doc.text("Description", SIMPLE_COLS.desc.x, ctx.y + 6);
  textRight(ctx, amountLabel, SIMPLE_COLS.amount, ctx.y + 6);

  ctx.advance(20);
  rule(ctx, C.border);
  ctx.advance(4);
}

export function drawSimpleTableRow(
  ctx: PDFRenderContext,
  description: string,
  amount: number,
  note?: string,
): void {
  if (ctx.willOverflow(30)) ctx.addPage();

  const y = ctx.y;
  ctx.doc.font("Helvetica").fontSize(9).fillColor(C.black);
  ctx.doc.text(description, SIMPLE_COLS.desc.x, y, { width: SIMPLE_COLS.desc.w });
  textRight(ctx, fmt(amount), SIMPLE_COLS.amount, y);

  if (note) {
    ctx.doc
      .font("Helvetica-Oblique")
      .fontSize(7)
      .fillColor(C.lightGray)
      .text(note, SIMPLE_COLS.desc.x, y + 12);
    ctx.advance(14);
  }

  ctx.advance(26);
  rule(ctx, C.border);
  ctx.advance(4);
}

// ─── Section totals block ─────────────────────────────────────────────────────

export function drawSectionTotals(
  ctx: PDFRenderContext,
  section: InvoiceSection,
  cgstLabel: string,
  sgstLabel: string,
): void {
  // Actual advances: subtotal(18) + [discount(18)] + [cgst+sgst(36)] + rule-gap(6) + section-total(18) + bottom-pad(16)
  const neededHeight =
    18 +
    (section.discount > 0 ? 18 : 0) +
    (section.taxTotal > 0 ? 36 : 0) +
    6 + 18 + 16;

  if (ctx.willOverflow(neededHeight)) ctx.addPage();

  filledRect(ctx, L, ctx.y, W, neededHeight, C.pageBg);

  const xLabel = 320;
  const xValue = R;
  const colW = xValue - xLabel;

  const row = (label: string, value: string, bold = false): void => {
    ctx.doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .fillColor(bold ? C.black : C.gray);
    ctx.doc.text(label, xLabel, ctx.y + 5, { width: colW - 80 });
    ctx.doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fillColor(C.black)
      .text(value, xLabel, ctx.y + 5, { width: colW, align: "right" });
    ctx.advance(18);
  };

  row("Subtotal (before GST):", fmt(section.subtotalBeforeTax));

  if (section.discount > 0) {
    row("Discount:", `-${fmt(section.discount)}`);
  }

  if (section.taxTotal > 0) {
    row(`${cgstLabel}:`, fmt(section.cgst));
    row(`${sgstLabel}:`, fmt(section.sgst));
  }

  rule(ctx, C.border);
  ctx.advance(6);
  row("Section Total:", fmt(section.sectionTotal), true);

  ctx.advance(16);
}

// ─── Page subtotal bar ────────────────────────────────────────────────────────

export function drawPageSubtotalBar(
  ctx: PDFRenderContext,
  label: string,
  total: number,
  bgColor: string,
  textColor: string,
): void {
  if (ctx.willOverflow(28)) ctx.addPage();

  filledRect(ctx, L, ctx.y, W, 24, bgColor);
  ctx.doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(textColor)
    .text(label, L + 8, ctx.y + 7);
  ctx.doc
    .fontSize(10)
    .text(fmt(total), L, ctx.y + 7, { width: W - 8, align: "right" });

  ctx.advance(32);
}

// ─── Summary table ─────────────────────────────────────────────────────────────

export function drawSummaryTable(ctx: PDFRenderContext): void {
  const d = ctx.invoiceData;
  const doc = ctx.doc;

  const xLabel = L;
  const xValue = R;
  const labelW = W - 120;
  const valueW = 120;

  const row = (
    label: string,
    value: string,
    bold = false,
    color: string = C.black,
    labelColor: string = C.gray,
  ): void => {
    doc
      .font(bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9)
      .fillColor(labelColor);
    doc.text(label, xLabel, ctx.y + 5, { width: labelW });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fillColor(color);
    doc.text(value, xLabel, ctx.y + 5, { width: xValue - xLabel, align: "right" });
    ctx.advance(20);
  };

  const thinRule = (): void => {
    rule(ctx, C.border, 0.5);
    ctx.advance(8);
  };

  const thickRule = (): void => {
    ctx.advance(2);
    rule(ctx, C.black, 1);
    ctx.advance(8);
  };

  // ── Charges breakdown ───────────────────────────────────────────────────────

  doc.font("Helvetica-Bold").fontSize(9).fillColor(C.gray).text("CHARGES BREAKDOWN", xLabel, ctx.y);
  ctx.advance(18);

  for (const sec of d.taxableSections) {
    const label =
      sec.type === "VEHICLE_RENTAL"   ? "Vehicle Rental (before GST)"  :
      sec.type === "EXTENSION_CHARGES" ? "Extension Charges (before GST)" :
      sec.type === "DAMAGE_PENALTY"    ? "Damage Penalty (before GST)"  :
      `${sec.title} (before GST)`;
    row(label, fmt(sec.subtotalBeforeTax - sec.discount));
  }

  for (const sec of d.nonTaxableSections) {
    const label =
      sec.type === "DAMAGE_COMPENSATION" ? "Damage Compensation" : sec.title;
    row(label, fmt(sec.subtotalBeforeTax));
  }

  thinRule();

  if (d.totalDiscount > 0) {
    row("Total Discount Applied", `-${fmt(d.totalDiscount)}`, false, C.gray);
    thinRule();
  }

  // ── Tax breakdown ───────────────────────────────────────────────────────────

  doc.font("Helvetica-Bold").fontSize(9).fillColor(C.gray).text("TAX BREAKDOWN", xLabel, ctx.y);
  ctx.advance(18);

  row(`CGST (${d.cgstRate}%)`, fmt(d.totalCgst));
  row(`SGST (${d.sgstRate}%)`, fmt(d.totalSgst));

  thinRule();
  row("Total GST", fmt(d.totalCgst + d.totalSgst));
  thickRule();

  // ── Grand total ─────────────────────────────────────────────────────────────

  if (ctx.willOverflow(36)) ctx.addPage();

  filledRect(ctx, L, ctx.y, W, 32, C.accent);
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor("#FFFFFF")
    .text("GRAND TOTAL", L + 8, ctx.y + 10);
  doc.text(fmt(d.grandTotal), L, ctx.y + 10, { width: W - 8, align: "right" });

  ctx.advance(40);

  // ── Payment information ─────────────────────────────────────────────────────

  if (ctx.willOverflow(80)) ctx.addPage();

  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor(C.gray)
    .text("PAYMENT INFORMATION", xLabel, ctx.y);
  ctx.advance(16);

  const payRows: [string, string][] = [
    ["Payment Status", d.paymentStatus],
  ];
  if (d.paymentMethod) payRows.push(["Payment Method", d.paymentMethod.replace("_", " ")]);
  if (d.safetyDepositApplied > 0)
    payRows.push(["Safety Deposit Applied", fmt(d.safetyDepositApplied)]);

  for (const [label, value] of payRows) {
    row(label, value, false, C.black, C.gray);
  }
}

// ─── Per-page footer (drawn retroactively with bufferedPages) ─────────────────

export function drawAllFooters(
  doc: InstanceType<typeof PDFDocument>,
  invoiceData: InvoiceData,
  totalPages: number,
): void {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const footerY = 752; // A4 content boundary = 842 - 50 margin = 792; keep well below it

    doc
      .save()
      .strokeColor(C.border)
      .lineWidth(0.5)
      .moveTo(L, footerY - 8)
      .lineTo(R, footerY - 8)
      .stroke()
      .restore();

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(C.lightGray)
      .text(
        "This is a computer-generated tax invoice and does not require a signature.",
        L,
        footerY,
        { width: 320 },
      );

    doc
      .font("Helvetica-Bold")
      .fontSize(7)
      .fillColor(C.gray)
      .text(`Page ${i + 1} of ${totalPages}`, L, footerY, {
        width: W,
        align: "right",
      });

    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(C.lightGray)
      .text(invoiceData.companyName, L, footerY + 11, {
        width: W,
        align: "center",
      });
  }
}
