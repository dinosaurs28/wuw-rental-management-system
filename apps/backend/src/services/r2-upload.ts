import { r2 } from "../lib/r2.client.js";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
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
 * Uploads invoice PDF to Cloudflare R2 and creates a FileObject record.
 *
 * Each upload gets a timestamp-versioned key so every regeneration produces a
 * unique URL, bypassing Cloudflare CDN cache for `.r2.dev` public buckets.
 *
 * When `previousFileObjectId` is supplied (regeneration path), the old R2
 * object and FileObject row are deleted after the new upload succeeds.
 */
export async function uploadInvoicePDFToR2(
  pdfBuffer: Buffer,
  invoiceNumber: string,
  bookingId: number,
  previousFileObjectId?: number,
): Promise<UploadResult> {
  try {
    console.log(`[R2 Upload] Uploading invoice ${invoiceNumber} to R2`);

    const safeInvoiceNumber = invoiceNumber.replace(/\//g, "-");
    // Timestamp suffix guarantees a unique URL on every upload — prevents CDN
    // cache from serving a stale PDF when the same invoice is regenerated.
    const version = Date.now();
    const key = `invoices/${safeInvoiceNumber}-v${version}.pdf`;

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

    const fileObject = await prisma.fileObject.create({
      data: {
        publicId: createID(),
        key,
        url: `${R2_PUBLIC_URL}/${key}`,
        mime: "application/pdf",
        size: pdfBuffer.length,
      },
    });

    console.log(`[R2 Upload] Created FileObject record: ${fileObject.id}`);

    // Clean up the previous version from R2 and the DB after the new one is safe
    if (previousFileObjectId) {
      try {
        const oldFile = await prisma.fileObject.findUnique({ where: { id: previousFileObjectId } });
        if (oldFile) {
          await r2.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: oldFile.key }));
          await prisma.fileObject.delete({ where: { id: previousFileObjectId } });
          console.log(`[R2 Upload] Deleted old file: ${oldFile.key}`);
        }
      } catch (cleanupErr) {
        // Non-fatal — old file will just remain in R2 unused
        console.warn(`[R2 Upload] Could not clean up old file ${previousFileObjectId}:`, cleanupErr);
      }
    }

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
