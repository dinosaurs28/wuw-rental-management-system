import { r2 } from "../lib/r2.client.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@repo/database/client";
import { createID } from "../utils/nanoID.js";

const BUCKET_NAME = process.env.R2_BUCKET_NAME!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

interface UploadResult {
  fileId: number;
  url: string;
  key: string;
}

/**
 * Uploads invoice PDF to Cloudflare R2 and creates FileObject record
 * @param pdfBuffer - PDF file as Buffer
 * @param invoiceNumber - Invoice number for file naming
 * @param bookingId - Booking ID for folder organization
 * @returns File ID and URL
 */
export async function uploadInvoicePDFToR2(
  pdfBuffer: Buffer,
  invoiceNumber: string,
  bookingId: number,
): Promise<UploadResult> {
  try {
    console.log(`[R2 Upload] Uploading invoice ${invoiceNumber} to R2`);

    // Create safe filename from invoice number (replace slashes with dashes)
    const safeInvoiceNumber = invoiceNumber.replace(/\//g, "-");
    const key = `invoices/${safeInvoiceNumber}.pdf`;

    // Upload to R2
    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: pdfBuffer,
        ContentType: "application/pdf",
        ContentDisposition: `inline; filename="${safeInvoiceNumber}.pdf"`,
      }),
    );

    console.log(`[R2 Upload] Successfully uploaded to R2: ${key}`);

    // Create FileObject record in database
    const fileObject = await prisma.fileObject.create({
      data: {
        publicId: createID(),
        key: key,
        url: `${R2_PUBLIC_URL}/${key}`,
        mime: "application/pdf",
        size: pdfBuffer.length,
      },
    });

    console.log(`[R2 Upload] Created FileObject record: ${fileObject.id}`);

    return {
      fileId: fileObject.id,
      url: fileObject.url,
      key: fileObject.key,
    };
  } catch (error) {
    console.error("[R2 Upload] Error uploading PDF to R2:", error);
    throw error;
  }
}

/**
 * Uploads return receipt PDF to Cloudflare R2 and creates FileObject record
 */
export async function uploadReceiptPDFToR2(
  pdfBuffer: Buffer,
  receiptNumber: string,
  bookingId: number,
): Promise<UploadResult> {
  try {
    console.log(`[R2 Upload] Uploading receipt ${receiptNumber} to R2`);

    const safeReceiptNumber = receiptNumber.replace(/\//g, "-");
    const key = `receipts/${safeReceiptNumber}.pdf`;

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: pdfBuffer,
        ContentType: "application/pdf",
        ContentDisposition: `inline; filename="${safeReceiptNumber}.pdf"`,
      }),
    );

    const fileObject = await prisma.fileObject.create({
      data: {
        publicId: createID(),
        key,
        url: `${R2_PUBLIC_URL}/${key}`,
        mime: "application/pdf",
        size: pdfBuffer.length,
      },
    });

    console.log(`[R2 Upload] Receipt FileObject created: ${fileObject.id}`);

    return {
      fileId: fileObject.id,
      url: fileObject.url,
      key: fileObject.key,
    };
  } catch (error) {
    console.error("[R2 Upload] Error uploading receipt PDF to R2:", error);
    throw error;
  }
}
