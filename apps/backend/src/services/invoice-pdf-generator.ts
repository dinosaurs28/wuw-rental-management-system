import PDFDocument from 'pdfkit';
import { InvoiceData } from './invoice-data-transformer.js';

/**
 * Generates a GST-compliant PDF invoice using PDFKit
 * @param invoiceData - Structured invoice data
 * @returns PDF as Buffer
 */
export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        try {
            console.log(`[Invoice PDF Generator] Generating PDF for ${invoiceData.invoiceNumber}`);

            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const chunks: Buffer[] = [];

            // Collect PDF chunks
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(chunks);
                console.log(`[Invoice PDF Generator] PDF generated successfully (${pdfBuffer.length} bytes)`);
                resolve(pdfBuffer);
            });
            doc.on('error', reject);

            // ====================
            // HEADER SECTION
            // ====================
            doc.fontSize(20).font('Helvetica-Bold').text('TAX INVOICE', 50, 50);

            // Company Details (Left)
            doc.fontSize(10).font('Helvetica-Bold').text(invoiceData.companyName, 50, 90);
            doc.fontSize(9).font('Helvetica').text(invoiceData.companyAddress, 50, 105, { width: 250 });
            doc.text(`Phone: ${invoiceData.companyPhone}`, 50, 130);
            doc.text(`Email: ${invoiceData.companyEmail}`, 50, 145);
            doc.text(`GSTIN: ${invoiceData.gstNumber}`, 50, 160);

            // Invoice Details (Right)
            doc.fontSize(10).font('Helvetica-Bold').text(`Invoice No: ${invoiceData.invoiceNumber}`, 350, 90);
            doc.fontSize(9).font('Helvetica').text(`Date: ${invoiceData.invoiceDate.toLocaleDateString('en-IN')}`, 350, 105);
            doc.text(`Booking ID: ${invoiceData.bookingPublicId}`, 350, 120);

            // Horizontal line
            doc.strokeColor('#000000').lineWidth(1).moveTo(50, 180).lineTo(545, 180).stroke();

            // ====================
            // CUSTOMER INFORMATION
            // ====================
            let yPos = 200;
            doc.fontSize(10).font('Helvetica-Bold').text('Bill To:', 50, yPos);
            doc.fontSize(9).font('Helvetica').text(invoiceData.customerName, 50, yPos + 15);
            doc.text(invoiceData.customerEmail, 50, yPos + 30);
            doc.text(invoiceData.customerPhone, 50, yPos + 45);
            doc.text(invoiceData.customerAddress, 50, yPos + 60, { width: 250 });

            // Booking Period (Right)
            doc.fontSize(9).font('Helvetica-Bold').text('Rental Period:', 350, yPos);
            doc.font('Helvetica').text(`From: ${invoiceData.startDate.toLocaleDateString('en-IN')}`, 350, yPos + 15);
            doc.text(`To: ${invoiceData.endDate.toLocaleDateString('en-IN')}`, 350, yPos + 30);
            doc.text(`Duration: ${invoiceData.days} day(s)`, 350, yPos + 45);

            yPos += 120;
            doc.strokeColor('#000000').lineWidth(0.5).moveTo(50, yPos).lineTo(545, yPos).stroke();

            // ====================
            // TABLE HEADER
            // ====================
            yPos += 15;
            doc.fontSize(9).font('Helvetica-Bold');
            doc.text('Description', 50, yPos);
            doc.text('Days', 280, yPos);
            doc.text('Rate', 320, yPos);
            doc.text('Discount', 370, yPos);
            doc.text('Tax', 425, yPos);
            doc.text('Amount', 480, yPos);

            yPos += 15;
            doc.strokeColor('#000000').lineWidth(0.5).moveTo(50, yPos).lineTo(545, yPos).stroke();

            // ====================
            // LINE ITEMS
            // ====================
            yPos += 10;
            doc.font('Helvetica');

            for (const item of invoiceData.items) {
                // Check if we need a new page
                if (yPos > 700) {
                    doc.addPage();
                    yPos = 50;
                }

                doc.fontSize(9).text(item.description, 50, yPos, { width: 220 });
                doc.text(item.days.toString(), 280, yPos);
                doc.text(`₹${item.rate.toFixed(2)}`, 320, yPos);
                doc.text(`₹${item.discount.toFixed(2)}`, 370, yPos);
                doc.text(`₹${(item.cgst + item.sgst).toFixed(2)}`, 425, yPos);
                doc.text(`₹${item.amount.toFixed(2)}`, 480, yPos);

                yPos += 35;
            }

            yPos += 5;
            doc.strokeColor('#000000').lineWidth(0.5).moveTo(50, yPos).lineTo(545, yPos).stroke();

            // ====================
            // TOTALS SECTION
            // ====================
            yPos += 15;
            doc.fontSize(9).font('Helvetica');

            // Subtotal
            doc.text('Subtotal:', 400, yPos);
            doc.text(`₹${invoiceData.subtotal.toFixed(2)}`, 480, yPos);
            yPos += 15;

            // Discount
            if (invoiceData.totalDiscount > 0) {
                doc.text('Discount:', 400, yPos);
                doc.text(`-₹${invoiceData.totalDiscount.toFixed(2)}`, 480, yPos);
                yPos += 15;
            }

            // Tax Breakdown
            doc.text('CGST:', 400, yPos);
            doc.text(`₹${invoiceData.cgstAmount.toFixed(2)}`, 480, yPos);
            yPos += 15;

            doc.text('SGST:', 400, yPos);
            doc.text(`₹${invoiceData.sgstAmount.toFixed(2)}`, 480, yPos);
            yPos += 15;

            // Damage Charges
            if (invoiceData.damageCharges > 0) {
                doc.text('Damage Charges:', 400, yPos);
                doc.text(`₹${invoiceData.damageCharges.toFixed(2)}`, 480, yPos);
                yPos += 15;
            }

            // Grand Total
            yPos += 5;
            doc.strokeColor('#000000').lineWidth(1).moveTo(400, yPos).lineTo(545, yPos).stroke();
            yPos += 10;

            doc.fontSize(11).font('Helvetica-Bold');
            doc.text('Grand Total:', 400, yPos);
            doc.text(`₹${invoiceData.grandTotal.toFixed(2)}`, 480, yPos);

            // ====================
            // FOOTER
            // ====================
            const footerY = 750;
            doc.fontSize(8).font('Helvetica-Oblique');
            doc.text('Thank you for your business!', 50, footerY, { align: 'center', width: 495 });
            doc.fontSize(7).text('This is a computer-generated invoice and does not require a signature.', 50, footerY + 15, { align: 'center', width: 495 });

            // Finalize PDF
            doc.end();

        } catch (error) {
            console.error('[Invoice PDF Generator] Error generating PDF:', error);
            reject(error);
        }
    });
}
