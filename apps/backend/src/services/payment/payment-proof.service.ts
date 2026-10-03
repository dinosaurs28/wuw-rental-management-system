/**
 * UPI payment proof (Oct 2026 TODO #3) — a photo of the customer's
 * payment-success screen, taken at the counter when the customer pays the
 * branch's merchant UPI QR. It replaces typing the 12-digit UTR in every Fleet
 * flow that offers UPI (walk-in create, pickup / drop / extension sessions,
 * extension collect, legacy remaining payment, split payments) and in the
 * branch manager's credit clearance.
 *
 *  - Upload first (POST /api/{employee|branchManager}/payment/proof, multipart
 *    "file"): the image is decoded, re-encoded as a JPEG (EXIF / GPS stripped,
 *    orientation baked in) and stored in the PRIVATE bucket under
 *    `payment-proof/b<branchId>/<uploader>/…`. Only 15-minute presigned URLs
 *    ever leave the server.
 *  - The payment request then sends `proof_file_id` (the FileObject publicId);
 *    the server checks it is a proof uploaded in the same branch and not
 *    already backing another live payment, and stores it on
 *    PaymentTransaction.proofFileId.
 *  - Old app builds still send a UTR — that path is unchanged. A request may
 *    carry both; then both are checked.
 *
 * Every rule here throws CounterGuardError, which every counter-payment
 * controller already turns into `{ success:false, code, message }`.
 */
import fs from "fs/promises";
import sharp from "sharp";
import { prisma } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import { PAYMENT_PROOF_REQUIRED_MESSAGE } from "@repo/schemas";
import { uploadKycToR2, generatePresignedUrl } from "../r2-upload.js";
import { createID } from "../../utils/nanoID.js";
import { StatusCode } from "../../types/statusCode.js";
import { CounterGuardError, validateNewUtr, claimUtr } from "./counter-guard.service.js";

export { PAYMENT_PROOF_MAX_BYTES } from "@repo/schemas";

/** A screenshot of a payment app is at least this wide/tall. */
const PROOF_MIN_SIDE_PX = 200;
const PROOF_MAX_SIDE_PX = 2000;
const PROOF_JPEG_QUALITY = 82;
export const PAYMENT_PROOF_URL_TTL_SECONDS = 900;

const ACCEPTED_FORMATS = new Set(["jpeg", "png", "webp", "heif"]);

type Db = Prisma.TransactionClient | typeof prisma;

export type PaymentProofErrorCode = "FILE_REQUIRED" | "INVALID_IMAGE" | "IMAGE_TOO_SMALL";

export class PaymentProofError extends Error {
  constructor(
    public readonly status: StatusCode,
    public readonly code: PaymentProofErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaymentProofError";
  }

  toJSON() {
    return { success: false, code: this.code, message: this.message };
  }
}

export interface PaymentProofView {
  /** FileObject publicId — send it as `proof_file_id` */
  proofFileId: string;
  publicId: string;
  url: string;
  mime: string;
  size: number;
  capturedAt: string;
  expiresIn: number;
}

const PROOF_FILE_SELECT = {
  id: true,
  publicId: true,
  key: true,
  mime: true,
  size: true,
  createdAt: true,
} satisfies Prisma.FileObjectSelect;

type ProofFileRow = Prisma.FileObjectGetPayload<{ select: typeof PROOF_FILE_SELECT }>;

/** Every proof uploaded in a branch lives under this key prefix (branch scope check). */
function branchKeyPrefix(branchId: number): string {
  return `payment-proof/b${branchId}/`;
}

export async function toPaymentProofView(file: ProofFileRow): Promise<PaymentProofView> {
  return {
    proofFileId: file.publicId,
    publicId: file.publicId,
    url: await generatePresignedUrl(file.key, PAYMENT_PROOF_URL_TTL_SECONDS),
    mime: file.mime,
    size: file.size,
    capturedAt: file.createdAt.toISOString(),
    expiresIn: PAYMENT_PROOF_URL_TTL_SECONDS,
  };
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Reads the multer temp file (always deleting it), checks it is a real photo
 * and re-encodes it as a JPEG. sharp drops EXIF/GPS unless asked to keep it;
 * `.rotate()` bakes the EXIF orientation in first.
 */
async function normaliseProofPhoto(tmpPath: string): Promise<Buffer> {
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
    throw new PaymentProofError(
      StatusCode.BAD_REQUEST,
      "INVALID_IMAGE",
      "This file is not a readable photo. Take a photo of the customer's payment screen (JPG, PNG or WebP).",
    );
  }
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format) || !meta.width || !meta.height) {
    throw new PaymentProofError(StatusCode.BAD_REQUEST, "INVALID_IMAGE", "Only JPG, PNG or WebP photos are accepted.");
  }
  if (meta.width < PROOF_MIN_SIDE_PX || meta.height < PROOF_MIN_SIDE_PX) {
    throw new PaymentProofError(
      StatusCode.BAD_REQUEST,
      "IMAGE_TOO_SMALL",
      `The photo is too small (${meta.width}×${meta.height}). It must be at least ${PROOF_MIN_SIDE_PX}×${PROOF_MIN_SIDE_PX} pixels so the payment details can be read.`,
    );
  }

  try {
    return await sharp(raw)
      .rotate()
      .resize({ width: PROOF_MAX_SIDE_PX, height: PROOF_MAX_SIDE_PX, fit: sharp.fit.inside, withoutEnlargement: true })
      .jpeg({ quality: PROOF_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new PaymentProofError(
      StatusCode.BAD_REQUEST,
      "INVALID_IMAGE",
      meta.format === "heif"
        ? "HEIC photos can't be read. Please retake the photo as a JPG (iPhone: Settings → Camera → Formats → Most Compatible)."
        : "This photo could not be read. Please retake it as a JPG, PNG or WebP photo.",
    );
  }
}

/** Stores an uploaded payment-proof photo for a branch and returns its view. */
export async function savePaymentProof(input: {
  tmpPath: string;
  branchId: number;
  uploaderPublicId: string;
}): Promise<PaymentProofView> {
  const buffer = await normaliseProofPhoto(input.tmpPath);
  const key = `${branchKeyPrefix(input.branchId)}${input.uploaderPublicId}/${createID()}.jpg`;
  const { fileId } = await uploadKycToR2(buffer, key, "image/jpeg", buffer.length);
  const file = await prisma.fileObject.findUniqueOrThrow({ where: { id: fileId }, select: PROOF_FILE_SELECT });
  return toPaymentProofView(file);
}

/** A proof uploaded in this branch, by its publicId — or null. */
export async function findBranchProof(publicId: string, branchId: number, db: Db = prisma): Promise<ProofFileRow | null> {
  const file = await db.fileObject.findUnique({ where: { publicId }, select: PROOF_FILE_SELECT });
  if (!file || !file.key.startsWith(branchKeyPrefix(branchId))) return null;
  return file;
}

// ── Use on a payment ──────────────────────────────────────────────────────────

export interface ResolvedProof {
  /** FileObject.id — stored on PaymentTransaction.proofFileId */
  id: number;
  publicId: string;
}

/** Throws DUPLICATE_PAYMENT_PROOF if the photo already backs a live payment. */
async function assertProofUnused(fileId: number, db: Db): Promise<void> {
  const used = await db.paymentTransaction.findFirst({
    where: { proofFileId: fileId, status: { notIn: ["FAILED", "REJECTED"] } },
    select: { publicId: true },
  });
  if (used) {
    throw new CounterGuardError(
      StatusCode.CONFLICT,
      "DUPLICATE_PAYMENT_PROOF",
      "This payment photo is already attached to another payment. Take a photo of this payment's success screen.",
    );
  }
}

/**
 * Validates an optional `proof_file_id`. Omitted / null / "" → null.
 * Otherwise it must be a payment proof uploaded in this branch and not already
 * backing a live payment.
 */
export async function resolvePaymentProof(raw: unknown, branchId: number, db: Db = prisma): Promise<ResolvedProof | null> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new CounterGuardError(StatusCode.BAD_REQUEST, "INVALID_PAYMENT_PROOF", "proof_file_id must be the id of the uploaded payment photo.");
  }
  const file = await findBranchProof(raw.trim(), branchId, db);
  if (!file) {
    throw new CounterGuardError(
      StatusCode.BAD_REQUEST,
      "INVALID_PAYMENT_PROOF",
      "The payment photo wasn't found. Take the photo of the customer's payment screen again.",
    );
  }
  await assertProofUnused(file.id, db);
  return { id: file.id, publicId: file.publicId };
}

/**
 * Race-safe claim, INSIDE the transaction that writes the PaymentTransaction:
 * serialises on the photo, then re-checks it is unused (like claimUtr).
 */
export async function claimPaymentProof(proof: ResolvedProof, tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"payment-proof:" + proof.id}))`;
  await assertProofUnused(proof.id, tx);
}

export interface CounterUpi {
  /** Clean 12-digit UTR (old clients) or null */
  utr: string | null;
  proof: ResolvedProof | null;
}

/**
 * The backing of a counter UPI payment (or the UPI part of a split):
 *  - a `proof_file_id` photo (new clients) — a UTR sent alongside is checked too
 *  - else a 12-digit UTR (old clients; INVALID_UTR / DUPLICATE_UTR as before)
 *  - else 400 PAYMENT_PROOF_REQUIRED
 */
export async function resolveCounterUpi(input: {
  utr?: unknown;
  proofFileId?: unknown;
  branchId: number;
}): Promise<CounterUpi> {
  const rawUtr = typeof input.utr === "string" ? input.utr.trim() : "";
  const proof = await resolvePaymentProof(input.proofFileId, input.branchId);
  if (proof) {
    return { utr: rawUtr ? await validateNewUtr(rawUtr) : null, proof };
  }
  if (rawUtr) return { utr: await validateNewUtr(rawUtr), proof: null };
  throw new CounterGuardError(StatusCode.BAD_REQUEST, "PAYMENT_PROOF_REQUIRED", PAYMENT_PROOF_REQUIRED_MESSAGE);
}

/** claimUtr + claimPaymentProof for whatever backs the payment. */
export async function claimCounterUpi(upi: CounterUpi, tx: Prisma.TransactionClient): Promise<void> {
  if (upi.utr) await claimUtr(upi.utr, tx);
  if (upi.proof) await claimPaymentProof(upi.proof, tx);
}

// ── Read side (BM cash confirmations, shift detail, credit page) ─────────────

export interface ProofPhotoFields {
  proofPhoto: PaymentProofView | null;
  proofPhotoUrl: string | null;
}

/** Additive `proofPhoto` / `proofPhotoUrl` for a transaction row. Never throws. */
export async function proofPhotoFields(file: ProofFileRow | null | undefined): Promise<ProofPhotoFields> {
  if (!file) return { proofPhoto: null, proofPhotoUrl: null };
  try {
    const view = await toPaymentProofView(file);
    return { proofPhoto: view, proofPhotoUrl: view.url };
  } catch (err) {
    console.error("[PaymentProof] presign failed (non-fatal):", err);
    return { proofPhoto: null, proofPhotoUrl: null };
  }
}

/** Prisma select for the proof file on a PaymentTransaction read. */
export const PROOF_FILE_RELATION_SELECT = { select: PROOF_FILE_SELECT } as const;
