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
 *  - Oct 18 2026: up to three photos per payment (`proof_file_ids`, slot
 *    order; the customer may have paid in several UPI transactions). Each is
 *    checked like the single one and stored as PaymentTransactionProof rows
 *    (position 1–3); proofFileId stays the first photo for older readers.
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
import { normalizeProofIdList } from "./payment-proof-list.js";

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

/**
 * Throws DUPLICATE_PAYMENT_PROOF if the photo already backs a live payment —
 * as its first photo (proofFileId) or as any of its photos.
 */
async function assertProofUnused(fileId: number, db: Db, position?: number): Promise<void> {
  // A voided entry (Oct 2026) no longer backs its photo: the payment can be recorded again
  const live = { status: { notIn: ["FAILED", "REJECTED", "VOIDED"] } } satisfies Prisma.PaymentTransactionWhereInput;
  const used = await db.paymentTransaction.findFirst({
    where: { ...live, OR: [{ proofFileId: fileId }, { proofPhotos: { some: { fileId } } }] },
    select: { publicId: true },
  });
  if (used) {
    throw new CounterGuardError(
      StatusCode.CONFLICT,
      "DUPLICATE_PAYMENT_PROOF",
      position && position > 1
        ? `Payment photo ${position} is already attached to another payment. Take a photo of this payment's success screen.`
        : "This payment photo is already attached to another payment. Take a photo of this payment's success screen.",
      position ? { proofPosition: position } : undefined,
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
 * Validates the photos a payment names: `proof_file_ids` (new clients, 1–3 in
 * slot order) or the single `proof_file_id` (older builds). Nothing sent → [].
 * Each must be a payment proof uploaded in this branch and not already backing
 * a live payment; errors carry `proofPosition` (1–3) when about one photo.
 */
export async function resolvePaymentProofs(
  single: unknown,
  list: unknown,
  branchId: number,
  db: Db = prisma,
): Promise<ResolvedProof[]> {
  const parsed = normalizeProofIdList(single, list);
  if (!parsed.ok) {
    throw new CounterGuardError(
      StatusCode.BAD_REQUEST,
      "INVALID_PAYMENT_PROOF",
      parsed.message,
      parsed.position ? { proofPosition: parsed.position } : undefined,
    );
  }
  const multi = parsed.ids.length > 1;
  const proofs: ResolvedProof[] = [];
  for (const [i, id] of parsed.ids.entries()) {
    const position = i + 1;
    const file = await findBranchProof(id, branchId, db);
    if (!file) {
      throw new CounterGuardError(
        StatusCode.BAD_REQUEST,
        "INVALID_PAYMENT_PROOF",
        multi
          ? `Payment photo ${position} wasn't found. Take it again.`
          : "The payment photo wasn't found. Take the photo of the customer's payment screen again.",
        { proofPosition: position },
      );
    }
    await assertProofUnused(file.id, db, multi ? position : undefined);
    proofs.push({ id: file.id, publicId: file.publicId });
  }
  return proofs;
}

/**
 * Race-safe claim, INSIDE the transaction that writes the PaymentTransaction:
 * serialises on the photo, then re-checks it is unused (like claimUtr).
 */
export async function claimPaymentProof(proof: ResolvedProof, tx: Prisma.TransactionClient, position?: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"payment-proof:" + proof.id}))`;
  await assertProofUnused(proof.id, tx, position);
}

/** claimPaymentProof for every photo of a payment (locks taken in id order). */
export async function claimPaymentProofs(proofs: readonly ResolvedProof[], tx: Prisma.TransactionClient): Promise<void> {
  const ordered = proofs.map((p, i) => ({ p, position: i + 1 })).sort((a, b) => a.p.id - b.p.id);
  for (const { p, position } of ordered) await claimPaymentProof(p, tx, proofs.length > 1 ? position : undefined);
}

/**
 * Nested `proofPhotos` create for a PaymentTransaction write — every photo at
 * its position (1 = the one also stored on proofFileId). Undefined when none.
 */
export function proofPhotosCreate(
  proofs: readonly ResolvedProof[] | null | undefined,
): { create: { fileId: number; position: number }[] } | undefined {
  if (!proofs || proofs.length === 0) return undefined;
  return { create: proofs.map((p, i) => ({ fileId: p.id, position: i + 1 })) };
}

export interface CounterUpi {
  /** Clean 12-digit UTR (old clients) or null */
  utr: string | null;
  /** The first photo (stored on proofFileId) or null */
  proof: ResolvedProof | null;
  /** Every photo in slot order (first = `proof`); [] for a UTR-backed payment */
  proofs: ResolvedProof[];
}

/**
 * The backing of a counter UPI payment (or the UPI part of a split):
 *  - photos: `proof_file_ids` (1–3) or a single `proof_file_id` — a UTR sent
 *    alongside is checked too
 *  - else a 12-digit UTR (old clients; INVALID_UTR / DUPLICATE_UTR as before)
 *  - else 400 PAYMENT_PROOF_REQUIRED (the first photo is mandatory)
 */
export async function resolveCounterUpi(input: {
  utr?: unknown;
  proofFileId?: unknown;
  proofFileIds?: unknown;
  branchId: number;
}): Promise<CounterUpi> {
  const rawUtr = typeof input.utr === "string" ? input.utr.trim() : "";
  const proofs = await resolvePaymentProofs(input.proofFileId, input.proofFileIds, input.branchId);
  const [first] = proofs;
  if (first) {
    return { utr: rawUtr ? await validateNewUtr(rawUtr) : null, proof: first, proofs };
  }
  if (rawUtr) return { utr: await validateNewUtr(rawUtr), proof: null, proofs: [] };
  throw new CounterGuardError(StatusCode.BAD_REQUEST, "PAYMENT_PROOF_REQUIRED", PAYMENT_PROOF_REQUIRED_MESSAGE);
}

/** claimUtr + claimPaymentProofs for whatever backs the payment. */
export async function claimCounterUpi(upi: CounterUpi, tx: Prisma.TransactionClient): Promise<void> {
  if (upi.utr) await claimUtr(upi.utr, tx);
  const proofs = upi.proofs?.length ? upi.proofs : upi.proof ? [upi.proof] : [];
  if (proofs.length) await claimPaymentProofs(proofs, tx);
}

// ── Read side (BM cash confirmations, shift detail, credit page) ─────────────

/** One of a payment's photos, in slot order (1 = the first / required one). */
export interface PaymentProofItem extends PaymentProofView {
  /** FileObject publicId (same as proofFileId) */
  fileId: string;
  position: number;
}

export interface ProofPhotoFields {
  /** The first photo (older clients read only this) */
  proofPhoto: PaymentProofView | null;
  proofPhotoUrl: string | null;
  /** Every photo of the payment (1–3); [] when none */
  proofs: PaymentProofItem[];
}

type ProofPhotoRow = { position: number; file: ProofFileRow };

/**
 * Additive `proofPhoto` / `proofPhotoUrl` / `proofs` for a transaction row.
 * `photos` = its PaymentTransactionProof rows (PROOF_PHOTOS_RELATION_SELECT);
 * payments from before Oct 18 2026 have none and fall back to the single
 * proofFile. Never throws.
 */
export async function proofPhotoFields(
  file: ProofFileRow | null | undefined,
  photos?: readonly ProofPhotoRow[] | null,
): Promise<ProofPhotoFields> {
  const rows: ProofPhotoRow[] = photos?.length
    ? [...photos].sort((a, b) => a.position - b.position)
    : file
      ? [{ position: 1, file }]
      : [];
  if (rows.length === 0) return { proofPhoto: null, proofPhotoUrl: null, proofs: [] };
  try {
    const proofs = await Promise.all(
      rows.map(async (r) => ({ ...(await toPaymentProofView(r.file)), fileId: r.file.publicId, position: r.position })),
    );
    // The first photo: proofFileId when set, else position 1
    const firstItem = (file && proofs.find((p) => p.fileId === file.publicId)) || proofs[0]!;
    const { fileId: _fileId, position: _position, ...first } = firstItem;
    return { proofPhoto: first, proofPhotoUrl: first.url, proofs };
  } catch (err) {
    console.error("[PaymentProof] presign failed (non-fatal):", err);
    return { proofPhoto: null, proofPhotoUrl: null, proofs: [] };
  }
}

/** Prisma select for the proof file on a PaymentTransaction read. */
export const PROOF_FILE_RELATION_SELECT = { select: PROOF_FILE_SELECT } as const;

/** Prisma select for every photo of a PaymentTransaction (pass to proofPhotoFields). */
export const PROOF_PHOTOS_RELATION_SELECT = {
  select: { position: true, file: { select: PROOF_FILE_SELECT } },
  orderBy: { position: "asc" },
} as const;
