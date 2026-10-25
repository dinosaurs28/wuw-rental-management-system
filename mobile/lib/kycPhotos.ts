/**
 * KYC photos required to book: both sides of the driving licence (client,
 * Oct 17 2026) and both sides of the Aadhaar card (client, Oct 25 2026).
 * Mirrors packages/schemas/src/kyc-photos.ts by hand — the app doesn't import
 * @repo/schemas. Keep the two in step.
 *
 * Each document needs its FRONT + BACK on file and not REJECTED — PENDING and
 * APPROVED both count. The server refuses customer booking create and staff
 * walk-in create without them: 422 DL_PHOTOS_REQUIRED whenever the licence is
 * incomplete (the message names the Aadhaar too when it is also missing), else
 * 422 AADHAAR_PHOTOS_REQUIRED. A rejected side uploaded again replaces the old
 * photo. The walk-in QR photo never counts as the Aadhaar photos.
 */

export type KycPhotoType = 'DL' | 'AADHAAR';

export type KycPhotoSide = 'FRONT' | 'BACK';

export const KYC_PHOTO_SIDES: readonly KycPhotoSide[] = ['FRONT', 'BACK'];

export const REQUIRED_KYC_PHOTO_TYPES: readonly KycPhotoType[] = ['DL', 'AADHAAR'];

export const DL_PHOTOS_REQUIRED = 'DL_PHOTOS_REQUIRED';
export const DL_PHOTOS_REQUIRED_MESSAGE = 'Upload both sides of your driving licence to book.';
export const DL_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's driving licence before creating the booking.";

export const AADHAAR_PHOTOS_REQUIRED = 'AADHAAR_PHOTOS_REQUIRED';
export const AADHAAR_PHOTOS_REQUIRED_MESSAGE = 'Upload both sides of your Aadhaar card to book.';
export const AADHAAR_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's Aadhaar before creating the booking.";

export const KYC_PHOTOS_REQUIRED_MESSAGE = 'Upload both sides of your driving licence and Aadhaar card to book.';
export const KYC_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's driving licence and Aadhaar before creating the booking.";

/** True for either refusal code (both open the documents step). */
export function isKycPhotosRequiredCode(code: unknown): boolean {
  return code === DL_PHOTOS_REQUIRED || code === AADHAAR_PHOTOS_REQUIRED;
}

export interface KycPhotoDocLike {
  type: string;
  side: string;
  status?: string | null;
}

export function isUsableKycPhoto(doc: KycPhotoDocLike, type: KycPhotoType, side?: KycPhotoSide): boolean {
  return doc.type === type && (side === undefined || doc.side === side) && doc.status !== 'REJECTED';
}

export interface KycPhotosState<T extends KycPhotoDocLike> {
  ok: boolean;
  front: T | null;
  back: T | null;
  missingSides: KycPhotoSide[];
  rejectedSides: KycPhotoSide[];
}

export function kycPhotosState<T extends KycPhotoDocLike>(
  type: KycPhotoType,
  docs: readonly T[] | null | undefined,
): KycPhotosState<T> {
  const list = docs ?? [];
  const front = list.find((d) => isUsableKycPhoto(d, type, 'FRONT')) ?? null;
  const back = list.find((d) => isUsableKycPhoto(d, type, 'BACK')) ?? null;
  const missingSides = KYC_PHOTO_SIDES.filter((s) => (s === 'FRONT' ? !front : !back));
  const rejectedSides = missingSides.filter((s) =>
    list.some((d) => d.type === type && d.side === s && d.status === 'REJECTED'),
  );
  return { ok: missingSides.length === 0, front, back, missingSides, rejectedSides };
}

export function aadhaarPhotosState<T extends KycPhotoDocLike>(docs: readonly T[] | null | undefined): KycPhotosState<T> {
  return kycPhotosState('AADHAAR', docs);
}

export interface RequiredKycPhotosState<T extends KycPhotoDocLike> {
  ok: boolean;
  dl: KycPhotosState<T>;
  aadhaar: KycPhotosState<T>;
  missingTypes: KycPhotoType[];
}

/** The combined "required documents" check: DL + Aadhaar, FRONT + BACK each. */
export function requiredKycPhotosState<T extends KycPhotoDocLike>(
  docs: readonly T[] | null | undefined,
): RequiredKycPhotosState<T> {
  const dl = kycPhotosState('DL', docs);
  const aadhaar = kycPhotosState('AADHAAR', docs);
  const missingTypes = REQUIRED_KYC_PHOTO_TYPES.filter((t) => !(t === 'DL' ? dl : aadhaar).ok);
  return { ok: missingTypes.length === 0, dl, aadhaar, missingTypes };
}

/** The refusal message for the missing documents (names both when both are missing). */
export function kycPhotosRequiredMessage(
  missingTypes: readonly KycPhotoType[],
  audience: 'customer' | 'staff' = 'customer',
): string {
  const dl = missingTypes.includes('DL');
  const aadhaar = missingTypes.includes('AADHAAR');
  if (dl && aadhaar) return audience === 'staff' ? KYC_PHOTOS_REQUIRED_STAFF_MESSAGE : KYC_PHOTOS_REQUIRED_MESSAGE;
  if (aadhaar) return audience === 'staff' ? AADHAAR_PHOTOS_REQUIRED_STAFF_MESSAGE : AADHAAR_PHOTOS_REQUIRED_MESSAGE;
  return audience === 'staff' ? DL_PHOTOS_REQUIRED_STAFF_MESSAGE : DL_PHOTOS_REQUIRED_MESSAGE;
}

/** "front", "back" or "front and back". */
export function describeKycPhotoSides(sides: readonly KycPhotoSide[]): string {
  return sides.map((s) => s.toLowerCase()).join(' and ');
}
