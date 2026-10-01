/**
 * Customer QR code photo — a photo of the QR the walk-in customer presents
 * (Aadhaar secure QR, DigiLocker, …). Stored as an image only; never decoded.
 *
 *  - Customer.qrPhotoFileId is the customer's CURRENT photo (staff can
 *    capture, replace or remove it).
 *  - Booking.qrPhotoFileId is a SNAPSHOT taken when the walk-in booking is
 *    created. It can be replaced while the booking is HOLD or CONFIRMED and is
 *    frozen from PICKED_UP onwards.
 *
 * One FileObject can be referenced by the customer and by any number of
 * booking snapshots, so a file is only purged from R2 once nothing references
 * it any more. Files live in the PRIVATE bucket and are only ever handed out
 * as 15-minute presigned URLs — the raw key never leaves the server.
 */
import fs from "fs/promises";
import sharp from "sharp";
import { prisma, BookingStatus } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { uploadKycToR2, generatePresignedUrl } from "../r2-upload.js";
import { fileCleanupQueue } from "../../lib/queue.client.js";
import { PRIVATE_BUCKET } from "../../lib/r2.client.js";
import { createID } from "../../utils/nanoID.js";
import { StatusCode } from "../../types/statusCode.js";

export const QR_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const QR_PHOTO_MIN_SIDE_PX = 300;
// Stored copy is capped at this many pixels on the longer side.
const QR_PHOTO_MAX_SIDE_PX = 2000;
// Higher than the generic 80 so dense QR codes stay readable.
const QR_PHOTO_JPEG_QUALITY = 85;
export const QR_PHOTO_URL_TTL_SECONDS = 900;

/** A booking's snapshot can only be replaced before the vehicle leaves. */
export const QR_PHOTO_REPLACEABLE_STATUSES: BookingStatus[] = [
  BookingStatus.HOLD,
  BookingStatus.CONFIRMED,
];

// sharp `metadata().format` values we accept. HEIF covers HEIC/AVIF, but only
// files the installed libvips can actually decode get through (see below).
const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

export type QrPhotoErrorCode =
  | "INVALID_IMAGE"
  | "IMAGE_TOO_SMALL"
  | "QR_PHOTO_FROZEN"
  | "QR_PHOTO_NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "BOOKING_NOT_FOUND";

export class QrPhotoError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: QrPhotoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QrPhotoError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message };
  }
}

export const QR_FILE_SELECT = {
  id: true,
  publicId: true,
  key: true,
  mime: true,
  size: true,
  createdAt: true,
} satisfies Prisma.FileObjectSelect;

export type QrFileRow = Prisma.FileObjectGetPayload<{ select: typeof QR_FILE_SELECT }>;

export interface QrPhotoView {
  publicId: string;
  url: string;
  mime: string;
  size: number;
  capturedAt: string;
  expiresIn: number;
}

export type QrPhotoSource = "BOOKING" | "CUSTOMER";

export async function toQrPhotoView(
  file: QrFileRow,
  capturedAt?: Date | null,
): Promise<QrPhotoView> {
  return {
    publicId: file.publicId,
    url: await generatePresignedUrl(file.key, QR_PHOTO_URL_TTL_SECONDS),
    mime: file.mime,
    size: file.size,
    capturedAt: (capturedAt ?? file.createdAt).toISOString(),
    expiresIn: QR_PHOTO_URL_TTL_SECONDS,
  };
}

// ── Image pipeline ────────────────────────────────────────────────────────────

/**
 * Reads the multer temp file (always deleting it), decodes the real bytes and
 * re-encodes them as a JPEG. sharp drops EXIF/GPS and every other metadata
 * block unless asked to keep it, and `.rotate()` bakes the EXIF orientation
 * into the pixels first so nothing is lost by stripping it.
 */
async function normaliseQrPhoto(tmpPath: string): Promise<Buffer> {
  let raw: Buffer;
  try {
    raw = await fs.readFile(tmpPath);
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  let meta: sharp.Metadata;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw new QrPhotoError(
      StatusCode.BAD_REQUEST,
      "INVALID_IMAGE",
      "This file is not a readable photo. Please upload a JPG, PNG or WebP photo.",
    );
  }

  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height) {
    throw new QrPhotoError(
      StatusCode.BAD_REQUEST,
      "INVALID_IMAGE",
      "Only JPG, PNG or WebP photos are accepted.",
    );
  }

  if (meta.width < QR_PHOTO_MIN_SIDE_PX || meta.height < QR_PHOTO_MIN_SIDE_PX) {
    throw new QrPhotoError(
      StatusCode.BAD_REQUEST,
      "IMAGE_TOO_SMALL",
      `The photo is too small (${meta.width}×${meta.height}). It must be at least ${QR_PHOTO_MIN_SIDE_PX}×${QR_PHOTO_MIN_SIDE_PX} pixels so the QR code stays readable.`,
    );
  }

  try {
    return await sharp(raw)
      .rotate()
      .resize({
        width: QR_PHOTO_MAX_SIDE_PX,
        height: QR_PHOTO_MAX_SIDE_PX,
        fit: sharp.fit.inside,
        withoutEnlargement: true,
      })
      .jpeg({ quality: QR_PHOTO_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch {
    // Typically an iPhone HEIC: the prebuilt libvips reads the HEIF container
    // but has no HEVC decoder.
    throw new QrPhotoError(
      StatusCode.BAD_REQUEST,
      "INVALID_IMAGE",
      meta.format === "heif"
        ? "HEIC photos can't be read. Please retake the photo as a JPG (iPhone: Settings → Camera → Formats → Most Compatible)."
        : "This photo could not be read. Please retake it as a JPG, PNG or WebP photo.",
    );
  }
}

// ── R2 housekeeping ───────────────────────────────────────────────────────────

async function enqueuePrivateDelete(key: string): Promise<void> {
  try {
    await fileCleanupQueue.add("delete-qr-photo-file", { key, bucket: PRIVATE_BUCKET });
  } catch (err) {
    console.error(`[QrPhoto] Failed to queue R2 cleanup for ${key}:`, err);
  }
}

/**
 * Deletes the FileObject (and queues the R2 object for deletion) only when no
 * customer, booking snapshot or KYC record still points at it. Returns whether
 * the file was purged. Never throws — a leftover file is preferable to losing
 * a request that already succeeded.
 */
export async function releaseQrPhotoFileIfUnreferenced(fileId: number): Promise<boolean> {
  try {
    const key = await prisma.$transaction(async (tx) => {
      const file = await tx.fileObject.findUnique({
        where: { id: fileId },
        select: {
          key: true,
          _count: {
            select: {
              customerQrPhotos: true,
              bookingQrPhotos: true,
              customerKycs: true,
              bookingKycs: true,
            },
          },
        },
      });
      if (!file) return null;
      const refs =
        file._count.customerQrPhotos +
        file._count.bookingQrPhotos +
        file._count.customerKycs +
        file._count.bookingKycs;
      if (refs > 0) return null;
      await tx.fileObject.delete({ where: { id: fileId } });
      return file.key;
    });

    if (!key) return false;
    await enqueuePrivateDelete(key);
    return true;
  } catch (err) {
    console.error(`[QrPhoto] Could not release file ${fileId}:`, err);
    return false;
  }
}

// ── Capture / replace ─────────────────────────────────────────────────────────

export interface SaveQrPhotoInput {
  customerId: number;
  customerPublicId: string;
  /** multer temp file path — always deleted by this function. */
  tmpPath: string;
  actorUserId: number;
  /** Also replace this booking's snapshot (must be HOLD or CONFIRMED). */
  bookingId?: number;
}

export interface SaveQrPhotoResult {
  file: QrFileRow;
  capturedAt: Date;
  /** The customer already had a photo that this one replaced. */
  replacedCustomerPhoto: boolean;
  /** The booking already had a snapshot that this one replaced. */
  replacedBookingPhoto: boolean;
}

export async function saveCustomerQrPhoto(input: SaveQrPhotoInput): Promise<SaveQrPhotoResult> {
  const buffer = await normaliseQrPhoto(input.tmpPath);

  const key = `customer-qr/${input.customerPublicId}/${createID()}.jpg`;
  const { fileId } = await uploadKycToR2(buffer, key, "image/jpeg", buffer.length);
  const capturedAt = new Date();

  let previousCustomerFileId: number | null;
  let previousBookingFileId: number | null = null;
  let file: QrFileRow;

  try {
    ({ previousCustomerFileId, previousBookingFileId, file } = await prisma.$transaction(
      async (tx) => {
        const before = await tx.customer.findUniqueOrThrow({
          where: { id: input.customerId },
          select: { qrPhotoFileId: true },
        });

        await tx.customer.update({
          where: { id: input.customerId },
          data: {
            qrPhotoFileId: fileId,
            qrPhotoCapturedAt: capturedAt,
            qrPhotoCapturedById: input.actorUserId,
          },
        });

        let bookingBefore: number | null = null;
        if (input.bookingId !== undefined) {
          const booking = await tx.booking.findUnique({
            where: { id: input.bookingId },
            select: { status: true, qrPhotoFileId: true, customerId: true },
          });
          if (!booking || booking.customerId !== input.customerId) {
            throw new QrPhotoError(StatusCode.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking not found");
          }
          // Conditional write so a pickup that lands mid-upload can't be overwritten.
          const updated = await tx.booking.updateMany({
            where: { id: input.bookingId, status: { in: QR_PHOTO_REPLACEABLE_STATUSES } },
            data: { qrPhotoFileId: fileId },
          });
          if (updated.count === 0) throw frozenError(booking.status);
          bookingBefore = booking.qrPhotoFileId;
        }

        const saved = await tx.fileObject.findUniqueOrThrow({
          where: { id: fileId },
          select: QR_FILE_SELECT,
        });

        return {
          previousCustomerFileId: before.qrPhotoFileId,
          previousBookingFileId: bookingBefore,
          file: saved,
        };
      },
    ));
  } catch (err) {
    // Nothing points at the new file yet — drop it so R2 doesn't collect orphans.
    await releaseQrPhotoFileIfUnreferenced(fileId);
    throw err;
  }

  const stale = new Set(
    [previousCustomerFileId, previousBookingFileId].filter(
      (id): id is number => typeof id === "number" && id !== fileId,
    ),
  );
  for (const id of stale) await releaseQrPhotoFileIfUnreferenced(id);

  return {
    file,
    capturedAt,
    replacedCustomerPhoto: previousCustomerFileId !== null,
    replacedBookingPhoto: previousBookingFileId !== null,
  };
}

export function frozenError(status: BookingStatus): QrPhotoError {
  return new QrPhotoError(
    StatusCode.CONFLICT,
    "QR_PHOTO_FROZEN",
    `The QR code photo on this booking can no longer be changed (booking is ${status}). It can only be replaced while the booking is on hold or confirmed.`,
  );
}

// ── Remove ────────────────────────────────────────────────────────────────────

/**
 * Clears the customer's current photo. Booking snapshots keep the file, so it
 * is only purged when no booking references it. Returns the removed file's
 * publicId, or null when the customer had no photo.
 */
export async function clearCustomerQrPhoto(customerId: number): Promise<string | null> {
  const removed = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { qrPhotoFileId: true, qrPhotoFile: { select: { publicId: true } } },
    });
    if (customer.qrPhotoFileId === null) return null;

    await tx.customer.update({
      where: { id: customerId },
      data: { qrPhotoFileId: null, qrPhotoCapturedAt: null, qrPhotoCapturedById: null },
    });
    return { fileId: customer.qrPhotoFileId, publicId: customer.qrPhotoFile?.publicId ?? null };
  });

  if (!removed) return null;
  await releaseQrPhotoFileIfUnreferenced(removed.fileId);
  return removed.publicId;
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export interface BookingQrPhotoSummary {
  qrPhoto: QrPhotoView | null;
  /** BOOKING = the snapshot on this booking; CUSTOMER = no snapshot, showing the customer's current photo. */
  source: QrPhotoSource | null;
  canReplace: boolean;
}

/**
 * The booking's snapshot, or — when the booking has none — the customer's
 * current photo, flagged by `source` so the UI can label it.
 */
export async function resolveBookingQrPhoto(booking: {
  status: BookingStatus;
  qrPhotoFile: QrFileRow | null;
  customer: { qrPhotoFile: QrFileRow | null; qrPhotoCapturedAt: Date | null };
}): Promise<BookingQrPhotoSummary> {
  const canReplace = QR_PHOTO_REPLACEABLE_STATUSES.includes(booking.status);
  if (booking.qrPhotoFile) {
    return { qrPhoto: await toQrPhotoView(booking.qrPhotoFile), source: "BOOKING", canReplace };
  }
  if (booking.customer.qrPhotoFile) {
    return {
      qrPhoto: await toQrPhotoView(booking.customer.qrPhotoFile, booking.customer.qrPhotoCapturedAt),
      source: "CUSTOMER",
      canReplace,
    };
  }
  return { qrPhoto: null, source: null, canReplace };
}

export const BOOKING_QR_SELECT = {
  status: true,
  qrPhotoFile: { select: QR_FILE_SELECT },
  customer: {
    select: {
      qrPhotoCapturedAt: true,
      qrPhotoFile: { select: QR_FILE_SELECT },
    },
  },
} satisfies Prisma.BookingSelect;

/**
 * Additive `qrPhoto` / `qrPhotoUrl` / `qrPhotoSource` fields for existing
 * booking-detail responses. Returns nulls (never throws) so a QR lookup
 * problem can't break the screen it is bolted onto.
 */
export async function getBookingQrPhotoFields(
  where: { id: number } | { publicId: string; branchId: number },
): Promise<{ qrPhoto: QrPhotoView | null; qrPhotoUrl: string | null; qrPhotoSource: QrPhotoSource | null }> {
  try {
    const booking = await prisma.booking.findFirst({ where, select: BOOKING_QR_SELECT });
    if (!booking) return { qrPhoto: null, qrPhotoUrl: null, qrPhotoSource: null };
    const { qrPhoto, source } = await resolveBookingQrPhoto(booking);
    return { qrPhoto, qrPhotoUrl: qrPhoto?.url ?? null, qrPhotoSource: source };
  } catch (err) {
    console.error("[QrPhoto] Booking QR lookup failed (non-fatal):", err);
    return { qrPhoto: null, qrPhotoUrl: null, qrPhotoSource: null };
  }
}

/**
 * Additive `qrPhoto` / `qrPhotoUrl` fields for the staff customer-detail
 * response (keyed by the customer's User.publicId). Never throws.
 */
export async function getCustomerQrPhotoFields(
  userPublicId: string,
): Promise<{ qrPhoto: QrPhotoView | null; qrPhotoUrl: string | null }> {
  try {
    const user = await prisma.user.findUnique({
      where: { publicId: userPublicId },
      select: {
        customerProfile: {
          select: { qrPhotoCapturedAt: true, qrPhotoFile: { select: QR_FILE_SELECT } },
        },
      },
    });
    const profile = user?.customerProfile;
    if (!profile?.qrPhotoFile) return { qrPhoto: null, qrPhotoUrl: null };
    const qrPhoto = await toQrPhotoView(profile.qrPhotoFile, profile.qrPhotoCapturedAt);
    return { qrPhoto, qrPhotoUrl: qrPhoto.url };
  } catch (err) {
    console.error("[QrPhoto] Customer QR lookup failed (non-fatal):", err);
    return { qrPhoto: null, qrPhotoUrl: null };
  }
}

// ── Walk-in booking create ────────────────────────────────────────────────────

/**
 * Validates the optional `qr_photo_id` sent with a staff booking. Omitted
 * (old builds) → allowed. Otherwise it must be the customer's CURRENT photo,
 * which catches a photo replaced in another tab or one carried over from a
 * different customer.
 *
 * Returns an error response body, or null when the request may proceed.
 */
export async function checkBookingQrPhotoId(
  qrPhotoId: unknown,
  customerQrPhotoFileId: number | null,
): Promise<{ status: StatusCode; body: { success: false; code: string; message: string } } | null> {
  if (qrPhotoId === undefined || qrPhotoId === null) return null;
  if (typeof qrPhotoId !== "string" || qrPhotoId.trim().length === 0) {
    return {
      status: StatusCode.BAD_REQUEST,
      body: {
        success: false,
        code: "INVALID_QR_PHOTO_ID",
        message: "qr_photo_id must be the id of the customer's QR code photo.",
      },
    };
  }
  const file =
    customerQrPhotoFileId === null
      ? null
      : await prisma.fileObject.findUnique({
          where: { id: customerQrPhotoFileId },
          select: { publicId: true },
        });
  if (!file || file.publicId !== qrPhotoId.trim()) {
    return {
      status: StatusCode.CONFLICT,
      body: {
        success: false,
        code: "QR_PHOTO_MISMATCH",
        message:
          "The customer's QR code photo was replaced or belongs to another customer. Please recheck the QR code photo and try again.",
      },
    };
  }
  return null;
}
