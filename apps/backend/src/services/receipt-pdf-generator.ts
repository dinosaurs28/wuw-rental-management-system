import PDFDocument from "pdfkit";

export interface ReceiptLineItem {
  label: string;
  amount: number;
  chargeType?: string;
}

export interface ReceiptData {
  receiptNumber: string;
  receiptDate: Date;

  // Company/Branch
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  gstNumber: string;

  // Customer
  customerName: string;
  customerEmail: string;
  customerPhone: string;

  // Booking
  bookingPublicId: string;
  startDate: Date;
  endDate: Date;
  days: number;

  // Line items (all charges at return)
  lineItems: ReceiptLineItem[];

  // Totals
  totalCharges: number;
  depositPaid: number;
  amountDue: number;    // customer pays
  refundAmount: number; // customer receives
}

export async function generateReceiptPDF(data: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── HEADER ──────────────────────────────────────────────────────────────
    doc.fontSize(20).font("Helvetica-Bold").text("RETURN RECEIPT", 50, 50);

    doc.fontSize(10).font("Helvetica-Bold").text(data.companyName, 50, 90);
    doc.fontSize(9).font("Helvetica").text(data.companyAddress, 50, 105, { width: 250 });
    doc.text(`Phone: ${data.companyPhone}`, 50, 130);
    doc.text(`Email: ${data.companyEmail}`, 50, 145);
    doc.text(`GSTIN: ${data.gstNumber}`, 50, 160);

    doc.fontSize(10).font("Helvetica-Bold").text(`Receipt No: ${data.receiptNumber}`, 350, 90);
    doc.fontSize(9).font("Helvetica").text(
      `Date: ${data.receiptDate.toLocaleDateString("en-IN")}`,
      350, 105,
    );
    doc.text(`Booking ID: ${data.bookingPublicId}`, 350, 120);

    doc.strokeColor("#000").lineWidth(1).moveTo(50, 180).lineTo(545, 180).stroke();

    // ── CUSTOMER INFO ────────────────────────────────────────────────────────
    let y = 200;
    doc.fontSize(10).font("Helvetica-Bold").text("Customer:", 50, y);
    doc.fontSize(9).font("Helvetica").text(data.customerName, 50, y + 15);
    doc.text(data.customerEmail, 50, y + 30);
    doc.text(data.customerPhone, 50, y + 45);

    doc.fontSize(9).font("Helvetica-Bold").text("Rental Period:", 350, y);
    doc.font("Helvetica")
      .text(`From: ${data.startDate.toLocaleDateString("en-IN")}`, 350, y + 15)
      .text(`To:   ${data.endDate.toLocaleDateString("en-IN")}`, 350, y + 30)
      .text(`Duration: ${data.days} day(s)`, 350, y + 45);

    doc.moveTo(50, y + 70).lineTo(545, y + 70).stroke();

    // ── CHARGE TABLE ─────────────────────────────────────────────────────────
    y += 90;
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Description", 50, y);
    doc.text("Amount (₹)", 450, y, { width: 95, align: "right" });

    doc.moveTo(50, y + 18).lineTo(545, y + 18).stroke();
    y += 25;

    doc.fontSize(9).font("Helvetica");
    for (const item of data.lineItems) {
      doc.text(item.label, 50, y, { width: 380 });
      doc.text(item.amount.toFixed(2), 450, y, { width: 95, align: "right" });
      y += 18;

      // New page if needed
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
    }

    doc.moveTo(50, y + 5).lineTo(545, y + 5).stroke();
    y += 15;

    // ── TOTALS ────────────────────────────────────────────────────────────────
    const addTotalRow = (label: string, value: string, bold = false) => {
      if (bold) doc.font("Helvetica-Bold"); else doc.font("Helvetica");
      doc.fontSize(9).text(label, 350, y, { width: 170 });
      doc.text(value, 450, y, { width: 95, align: "right" });
      y += 16;
    };

    addTotalRow("Total Charges:", `₹${data.totalCharges.toFixed(2)}`);
    addTotalRow("Deposit / Advance Paid:", `₹${data.depositPaid.toFixed(2)}`);

    doc.moveTo(350, y).lineTo(545, y).stroke();
    y += 8;

    if (data.amountDue > 0.009) {
      addTotalRow(`Balance Due:`, `₹${data.amountDue.toFixed(2)}`, true);
    } else if (data.refundAmount > 0.009) {
      addTotalRow(`Refund Amount:`, `₹${data.refundAmount.toFixed(2)}`, true);
    } else {
      addTotalRow(`Settled:`, "₹0.00 (Balanced)", true);
    }

    // ── FOOTER ────────────────────────────────────────────────────────────────
    y += 30;
    doc.fontSize(8).font("Helvetica").fillColor("#666666")
      .text("This is a computer-generated receipt and does not require a signature.", 50, y, {
        align: "center",
        width: 495,
      });

    doc.end();
  });
}
