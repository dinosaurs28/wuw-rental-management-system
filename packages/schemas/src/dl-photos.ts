/**
 * Driving licence photos are compulsory to book (client, Oct 17 2026).
 * Keep in sync with mobile/lib/dlPhotos.ts (the app doesn't import @repo/schemas).
 *
 * The DL view of the generic KYC photos rule in ./kyc-photos.ts (FRONT + BACK
 * on file, not REJECTED — PENDING and APPROVED count). Since Oct 25 2026 the
 * Aadhaar card is required the same way: use requiredKycPhotosState for the
 * full "can book" check.
 *
 * Refusals are 422 DL_PHOTOS_REQUIRED (code, constants and shape unchanged;
 * the constants live in ./kyc-photos.ts).
 */
import { isUsableKycPhoto, kycPhotosState, describeKycPhotoSides, type KycPhotoSide, type KycPhotosState } from "./kyc-photos.js";

export type DlPhotoSide = KycPhotoSide;

export const DL_PHOTO_SIDES: readonly DlPhotoSide[] = ["FRONT", "BACK"];

/** The minimum a KYC row needs for the rule (API rows, Prisma rows). */
export interface DlPhotoDocLike {
  type: string;
  side: string;
  status: string;
}

/** True when the document is a DL photo of `side` that counts (not REJECTED). */
export function isUsableDlPhoto(doc: DlPhotoDocLike, side?: DlPhotoSide): boolean {
  return isUsableKycPhoto(doc, "DL", side);
}

export type DlPhotosState<T extends DlPhotoDocLike> = KycPhotosState<T>;

export function dlPhotosState<T extends DlPhotoDocLike>(docs: readonly T[] | null | undefined): DlPhotosState<T> {
  return kycPhotosState("DL", docs);
}

export function hasDlPhotosOnFile(docs: readonly DlPhotoDocLike[] | null | undefined): boolean {
  return dlPhotosState(docs).ok;
}

/** "front", "back" or "front and back" — for messages. */
export function describeDlPhotoSides(sides: readonly DlPhotoSide[]): string {
  return describeKycPhotoSides(sides);
}
