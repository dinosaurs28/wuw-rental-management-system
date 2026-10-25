/**
 * KYC PHOTOS gate: both sides of the customer's driving licence (client,
 * Oct 17 2026) and both sides of their Aadhaar card (client, Oct 25 2026) must
 * be on file before a booking is created — customer checkout (HOLD) and staff
 * walk-in create. The rule itself (FRONT + BACK, a REJECTED side doesn't
 * count, PENDING and APPROVED do) is the shared @repo/schemas
 * requiredKycPhotosState.
 *
 * Refusals are 422:
 *   - DL_PHOTOS_REQUIRED whenever the DL is incomplete — same code and shape as
 *     before (missingSides / rejectedSides are the DL's), so old app builds keep
 *     their licence handling; the message names the Aadhaar too when it is also
 *     missing;
 *   - AADHAAR_PHOTOS_REQUIRED when only the Aadhaar is incomplete
 *     (missingSides / rejectedSides are the Aadhaar's).
 * Both add `missingDocuments`, `dlPhotos` and `aadhaarPhotos`. Old builds show
 * the message.
 *
 * The booking's KYC reference (Booking.kycFileId) is the DL FRONT photo unless
 * the request named one of the customer's DL photos itself.
 */
import { prisma, KycType } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import {
  DL_PHOTOS_REQUIRED,
  kycPhotosRequiredCode,
  kycPhotosRequiredMessage,
  requiredKycPhotosState,
  type KycPhotoSide,
  type KycPhotosAudience,
  type KycPhotosRequiredCode,
  type KycPhotosState,
  type KycPhotoType,
} from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";

type Db = Prisma.TransactionClient | typeof prisma;

export type DlPhotosAudience = KycPhotosAudience;

export interface KycPhotosSummary {
  ok: boolean;
  missingSides: KycPhotoSide[];
  rejectedSides: KycPhotoSide[];
}

/** The `{ ok, missingSides, rejectedSides }` view the API returns. */
export function kycPhotosSummary(state: KycPhotosState<any>): KycPhotosSummary {
  return { ok: state.ok, missingSides: state.missingSides, rejectedSides: state.rejectedSides };
}

/**
 * 422 DL_PHOTOS_REQUIRED / AADHAAR_PHOTOS_REQUIRED. The class keeps its old
 * name; the controllers' instanceof checks cover both codes.
 */
export class DlPhotosRequiredError extends Error {
  readonly status = StatusCode.UNPROCESSABLE_ENTITY;
  readonly code: KycPhotosRequiredCode;
  /** Documents with a side still needed, DL first. */
  readonly missingDocuments: KycPhotoType[];
  /** Top-level sides: the DL's for DL_PHOTOS_REQUIRED, the Aadhaar's otherwise. */
  readonly missingSides: KycPhotoSide[];
  readonly rejectedSides: KycPhotoSide[];

  constructor(
    public readonly audience: DlPhotosAudience,
    public readonly dlPhotos: KycPhotosSummary,
    public readonly aadhaarPhotos: KycPhotosSummary,
  ) {
    const missingDocuments: KycPhotoType[] = [];
    if (!dlPhotos.ok) missingDocuments.push("DL");
    if (!aadhaarPhotos.ok) missingDocuments.push("AADHAAR");
    super(kycPhotosRequiredMessage(missingDocuments, audience));
    this.name = "DlPhotosRequiredError";
    this.missingDocuments = missingDocuments;
    this.code = kycPhotosRequiredCode(missingDocuments);
    const lead = this.code === DL_PHOTOS_REQUIRED ? dlPhotos : aadhaarPhotos;
    this.missingSides = lead.missingSides;
    this.rejectedSides = lead.rejectedSides;
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      message: this.message,
      missingSides: this.missingSides,
      rejectedSides: this.rejectedSides,
      // Additive (Oct 25 2026): which documents and sides are needed.
      missingDocuments: this.missingDocuments,
      dlPhotos: this.dlPhotos,
      aadhaarPhotos: this.aadhaarPhotos,
    };
  }
}

export interface DlPhotosOnFile {
  frontFileId: number;
  backFileId: number;
  /** FileObject ids of every usable DL photo (either side). */
  fileIds: number[];
}

/**
 * The customer's usable DL photos, once the DL and the Aadhaar both have their
 * FRONT and BACK on file. Throws DlPhotosRequiredError (422
 * DL_PHOTOS_REQUIRED / AADHAAR_PHOTOS_REQUIRED) otherwise.
 */
export async function assertKycPhotosOnFile(
  customerId: number,
  audience: DlPhotosAudience,
  db: Db = prisma,
): Promise<DlPhotosOnFile> {
  const docs = await db.customerKyc.findMany({
    where: { customerId, type: { in: [KycType.DL, KycType.AADHAAR] } },
    select: { type: true, side: true, status: true, fileId: true },
  });
  const state = requiredKycPhotosState(docs);
  if (!state.ok || !state.dl.front || !state.dl.back) {
    throw new DlPhotosRequiredError(audience, kycPhotosSummary(state.dl), kycPhotosSummary(state.aadhaar));
  }
  return {
    frontFileId: state.dl.front.fileId,
    backFileId: state.dl.back.fileId,
    fileIds: [state.dl.front.fileId, state.dl.back.fileId],
  };
}

/**
 * The file the booking keeps as its KYC reference: the one the request named
 * when it is one of the customer's usable DL photos, otherwise the DL front.
 */
export function bookingDlKycFileId(onFile: DlPhotosOnFile, requestedFileId: number | null | undefined): number {
  return requestedFileId != null && onFile.fileIds.includes(requestedFileId) ? requestedFileId : onFile.frontFileId;
}
