/**
 * Driving licence photos are compulsory to book (client, Oct 17 2026).
 * Mirrors packages/schemas/src/dl-photos.ts by hand — the app doesn't import
 * @repo/schemas. Keep the two in step.
 *
 * The DL view of the generic rule in ./kycPhotos.ts: both DL sides (FRONT +
 * BACK) on file and not REJECTED — PENDING and APPROVED both count. Since
 * Oct 25 2026 the Aadhaar card is required the same way (requiredKycPhotosState).
 * The server refuses customer booking create and staff walk-in create without
 * the licence: 422 DL_PHOTOS_REQUIRED. A rejected side the customer uploads
 * again replaces the old photo.
 */
import { describeKycPhotoSides, isUsableKycPhoto, kycPhotosState, type KycPhotoSide, type KycPhotosState } from './kycPhotos';

export { DL_PHOTOS_REQUIRED, DL_PHOTOS_REQUIRED_MESSAGE, DL_PHOTOS_REQUIRED_STAFF_MESSAGE } from './kycPhotos';

export type DlPhotoSide = KycPhotoSide;

export const DL_PHOTO_SIDES: readonly DlPhotoSide[] = ['FRONT', 'BACK'];

export interface DlPhotoDocLike {
  type: string;
  side: string;
  status?: string;
}

export function isUsableDlPhoto(doc: DlPhotoDocLike, side?: DlPhotoSide): boolean {
  return isUsableKycPhoto(doc, 'DL', side);
}

export type DlPhotosState<T extends DlPhotoDocLike> = KycPhotosState<T>;

export function dlPhotosState<T extends DlPhotoDocLike>(docs: readonly T[] | null | undefined): DlPhotosState<T> {
  return kycPhotosState('DL', docs);
}

export function hasDlPhotosOnFile(docs: readonly DlPhotoDocLike[] | null | undefined): boolean {
  return dlPhotosState(docs).ok;
}

/** "front", "back" or "front and back". */
export function describeDlPhotoSides(sides: readonly DlPhotoSide[]): string {
  return describeKycPhotoSides(sides);
}
