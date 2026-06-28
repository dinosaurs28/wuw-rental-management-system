import { r2, PUBLIC_BUCKET, PRIVATE_BUCKET } from "../lib/r2.client.js";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@repo/database/client";
import { createID } from "../utils/nanoID.js";

interface UploadResult {
  fileId: number;
  url: string;
  key: string;
}

// ── Presigned URL ──────────────────────────────────────────────────────────────

/**
 * Generates a short-lived presigned GET URL for a private R2 object.
 * Default TTL: 5 minutes. Pass a larger value for KYC viewing sessions.
 */
export async function generatePresignedUrl(key: string, expiresIn = 300): Promise<string> {
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }),
    { expiresIn },
  );
}

// ── Invoice PDF ────────────────────────────────────────────────────────────────

/**
 * Uploads an invoice PDF to the **private** R2 bucket.
 *
 * - Timestamp-versioned key prevents CDN / presigner caching issues on regen.
 * - `FileObject.url` stores the R2 key (not a public URL) — callers must call
 *   `generatePresignedUrl(fileObject.key)` before returning to the client.
 * - If `previousFileObjectId` is supplied the old object + DB row are cleaned
 *   up after the new upload succeeds.
 */
export async function uploadInvoicePDFToR2(
  pdfBuffer: Buffer,
  invoiceNumber: string,
  bookingId: number,
  previousFileObjectId?: number,
): Promise<UploadResult> {
  console.log(`[R2 Upload] Uploading invoice ${invoiceNumber} to private bucket`);

  const safeInvoiceNumber = invoiceNumber.replace(/\//g, "-");
  const key = `invoices/${safeInvoiceNumber}-v${Date.now()}.pdf`;

  await r2.send(
    new PutObjectCommand({
      Bucket: PRIVATE_BUCKET,
      Key: key,
      Body: pdfBuffer,
      ContentType: "application/pdf",
      ContentDisposition: `inline; filename="${safeInvoiceNumber}.pdf"`,
    }),
  );

  console.log(`[R2 Upload] Invoice uploaded to private R2: ${key}`);

  // Store the key in the url field — controllers generate presigned URLs on demand
  const fileObject = await prisma.fileObject.create({
    data: {
      publicId: createID(),
      key,
      url: key,
      mime: "application/pdf",
      size: pdfBuffer.length,
    },
  });

  console.log(`[R2 Upload] Created FileObject record: ${fileObject.id}`);

  if (previousFileObjectId) {
    try {
      const oldFile = await prisma.fileObject.findUnique({ where: { id: previousFileObjectId } });
      if (oldFile) {
        await r2.send(new DeleteObjectCommand({ Bucket: PRIVATE_BUCKET, Key: oldFile.key }));
        await prisma.fileObject.delete({ where: { id: previousFileObjectId } });
        console.log(`[R2 Upload] Deleted old invoice file: ${oldFile.key}`);
      }
    } catch (err) {
      console.warn(`[R2 Upload] Could not clean up old invoice file ${previousFileObjectId}:`, err);
    }
  }

  return { fileId: fileObject.id, url: fileObject.url, key: fileObject.key };
}

// ── Receipt PDF ────────────────────────────────────────────────────────────────

/**
 * Uploads a return receipt PDF to the **private** R2 bucket.
 * Same key/url convention as invoices — serve via `generatePresignedUrl`.
 */
export async function uploadReceiptPDFToR2(
  pdfBuffer: Buffer,
  receiptNumber: string,
  bookingId: number,
): Promise<UploadResult> {
  console.log(`[R2 Upload] Uploading receipt ${receiptNumber} to private bucket`);

  const safeReceiptNumber = receiptNumber.replace(/\//g, "-");
  const key = `receipts/${safeReceiptNumber}.pdf`;

  await r2.send(
    new PutObjectCommand({
      Bucket: PRIVATE_BUCKET,
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
      url: key,
      mime: "application/pdf",
      size: pdfBuffer.length,
    },
  });

  console.log(`[R2 Upload] Receipt FileObject created: ${fileObject.id}`);

  return { fileId: fileObject.id, url: fileObject.url, key: fileObject.key };
}

// ── KYC document ───────────────────────────────────────────────────────────────

/**
 * Uploads a KYC document to the **private** R2 bucket.
 * Returns the key (not a public URL) — callers generate presigned URLs on demand.
 */
export async function uploadKycToR2(
  fileBuffer: Buffer,
  key: string,
  mimeType: string,
  size: number,
): Promise<UploadResult> {
  await r2.send(
    new PutObjectCommand({
      Bucket: PRIVATE_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: mimeType,
    }),
  );

  const fileObject = await prisma.fileObject.create({
    data: {
      publicId: createID(),
      key,
      url: key,
      mime: mimeType,
      size,
    },
  });

  return { fileId: fileObject.id, url: key, key };
}

// ── Public file deletion (pickup / return / damage photos) ────────────────────

export async function deletePublicFileFromR2(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: PUBLIC_BUCKET, Key: key }));
}

export async function deletePrivateFileFromR2(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: PRIVATE_BUCKET, Key: key }));
}
