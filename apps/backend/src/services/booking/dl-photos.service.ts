/**
 * Driving licence PHOTOS gate (client, Oct 17 2026): both sides of the
 * customer's DL must be on file before a booking is created — customer
 * checkout (HOLD) and staff walk-in create. The rule itself (FRONT + BACK, a
 * REJECTED side doesn't count, PENDING and APPROVED do) is the shared
 * @repo/schemas dlPhotosState.
 *
 * Refusals are 422 DL_PHOTOS_REQUIRED. Old app builds show the message (they
 * already offer DL upload in the profile / walk-in KYC screen).
 *
 * The booking's KYC reference (Booking.kycFileId) is the DL FRONT photo unless
 * the request named one of the customer's DL photos itself.
 */
import { prisma, KycType } from "@repo/database/client";
import type { Prisma } from "@repo/database/client";
import {
  DL_PHOTOS_REQUIRED,
  DL_PHOTOS_REQUIRED_MESSAGE,
  DL_PHOTOS_REQUIRED_STAFF_MESSAGE,
  dlPhotosState,
  type DlPhotoSide,
} from "@repo/schemas";
import { StatusCode } from "../../types/statusCode.js";

type Db = Prisma.TransactionClient | typeof prisma;

export type DlPhotosAudience = "customer" | "staff";

export class DlPhotosRequiredError extends Error {
  readonly code = DL_PHOTOS_REQUIRED;
  readonly status = StatusCode.UNPROCESSABLE_ENTITY;

  constructor(
    public readonly audience: DlPhotosAudience,
    public readonly missingSides: DlPhotoSide[],
    public readonly rejectedSides: DlPhotoSide[],
  ) {
    super(audience === "staff" ? DL_PHOTOS_REQUIRED_STAFF_MESSAGE : DL_PHOTOS_REQUIRED_MESSAGE);
    this.name = "DlPhotosRequiredError";
  }

  toJSON() {
    return {
      success: false,
      code: this.code,
      message: this.message,
      missingSides: this.missingSides,
      rejectedSides: this.rejectedSides,
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
 * The customer's usable DL photos. Throws DlPhotosRequiredError (422
 * DL_PHOTOS_REQUIRED) when the FRONT or the BACK is missing or rejected.
 */
export async function assertDlPhotosOnFile(
  customerId: number,
  audience: DlPhotosAudience,
  db: Db = prisma,
): Promise<DlPhotosOnFile> {
  const docs = await db.customerKyc.findMany({
    where: { customerId, type: KycType.DL },
    select: { type: true, side: true, status: true, fileId: true },
  });
  const state = dlPhotosState(docs);
  if (!state.ok || !state.front || !state.back) {
    throw new DlPhotosRequiredError(audience, state.missingSides, state.rejectedSides);
  }
  return {
    frontFileId: state.front.fileId,
    backFileId: state.back.fileId,
    fileIds: [state.front.fileId, state.back.fileId],
  };
}

/**
 * The file the booking keeps as its KYC reference: the one the request named
 * when it is one of the customer's usable DL photos, otherwise the DL front.
 */
export function bookingDlKycFileId(onFile: DlPhotosOnFile, requestedFileId: number | null | undefined): number {
  return requestedFileId != null && onFile.fileIds.includes(requestedFileId) ? requestedFileId : onFile.frontFileId;
}
