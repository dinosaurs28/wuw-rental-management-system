/**
 * KYC photos required to book: both sides of the driving licence (client,
 * Oct 17 2026) and both sides of the Aadhaar card (client, Oct 25 2026).
 * Keep in sync with mobile/lib/kycPhotos.ts (the app doesn't import @repo/schemas).
 *
 * A document type is "on file" when there is a KYC document of that type for
 * BOTH the FRONT and the BACK side whose status is not REJECTED — PENDING
 * (uploaded, not yet checked by staff) and APPROVED both count. A rejected
 * side has to be replaced before the next booking (re-upload replaces it in place).
 *
 * Checked at customer booking create (HOLD) and staff walk-in booking create,
 * shown at pickup. Refusals are 422:
 *   - DL missing (with or without Aadhaar) → DL_PHOTOS_REQUIRED (the code old
 *     app builds already know; its shape is unchanged, the message names both
 *     documents when both are missing);
 *   - only Aadhaar missing → AADHAAR_PHOTOS_REQUIRED.
 * Old builds show the response `message`.
 *
 * The walk-in "QR photo" (Customer.qrPhotoFileId) is a separate capture and
 * never counts as the Aadhaar photos.
 */

export type KycPhotoType = "DL" | "AADHAAR";

export type KycPhotoSide = "FRONT" | "BACK";

export const KYC_PHOTO_SIDES: readonly KycPhotoSide[] = ["FRONT", "BACK"];

/** Document types whose FRONT + BACK photos are required to book, DL first. */
export const REQUIRED_KYC_PHOTO_TYPES: readonly KycPhotoType[] = ["DL", "AADHAAR"];

export const DL_PHOTOS_REQUIRED = "DL_PHOTOS_REQUIRED" as const;
export const DL_PHOTOS_REQUIRED_MESSAGE = "Upload both sides of your driving licence to book.";
/** Staff wording (walk-in create / pickup). */
export const DL_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's driving licence before creating the booking.";

export const AADHAAR_PHOTOS_REQUIRED = "AADHAAR_PHOTOS_REQUIRED" as const;
export const AADHAAR_PHOTOS_REQUIRED_MESSAGE = "Upload both sides of your Aadhaar card to book.";
export const AADHAAR_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's Aadhaar before creating the booking.";

/** Both documents missing. */
export const KYC_PHOTOS_REQUIRED_MESSAGE = "Upload both sides of your driving licence and Aadhaar card to book.";
export const KYC_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's driving licence and Aadhaar before creating the booking.";

export type KycPhotosRequiredCode = typeof DL_PHOTOS_REQUIRED | typeof AADHAAR_PHOTOS_REQUIRED;

export type KycPhotosAudience = "customer" | "staff";

/** Display names, e.g. "Driving licence photos" / "Aadhaar photos". */
export const KYC_PHOTO_TYPE_LABEL: Record<KycPhotoType, string> = {
  DL: "Driving licence",
  AADHAAR: "Aadhaar",
};

/** The minimum a KYC row needs for the rule (API rows, Prisma rows). */
export interface KycPhotoDocLike {
  type: string;
  side: string;
  status?: string | null;
}

/** True when the document is a `type` photo of `side` that counts (not REJECTED). */
export function isUsableKycPhoto(doc: KycPhotoDocLike, type: KycPhotoType, side?: KycPhotoSide): boolean {
  return doc.type === type && (side === undefined || doc.side === side) && doc.status !== "REJECTED";
}

export interface KycPhotosState<T extends KycPhotoDocLike> {
  /** Both sides on file (not rejected). */
  ok: boolean;
  /** The usable FRONT / BACK documents, if any. */
  front: T | null;
  back: T | null;
  /** Sides still needed, FRONT first. */
  missingSides: KycPhotoSide[];
  /** Sides on file but REJECTED by staff (to be replaced). */
  rejectedSides: KycPhotoSide[];
}

export function kycPhotosState<T extends KycPhotoDocLike>(
  type: KycPhotoType,
  docs: readonly T[] | null | undefined,
): KycPhotosState<T> {
  const list = docs ?? [];
  const front = list.find((d) => isUsableKycPhoto(d, type, "FRONT")) ?? null;
  const back = list.find((d) => isUsableKycPhoto(d, type, "BACK")) ?? null;
  const missingSides = KYC_PHOTO_SIDES.filter((s) => (s === "FRONT" ? !front : !back));
  const rejectedSides = missingSides.filter((s) =>
    list.some((d) => d.type === type && d.side === s && d.status === "REJECTED"),
  );
  return { ok: missingSides.length === 0, front, back, missingSides, rejectedSides };
}

export function aadhaarPhotosState<T extends KycPhotoDocLike>(docs: readonly T[] | null | undefined): KycPhotosState<T> {
  return kycPhotosState("AADHAAR", docs);
}

export function hasAadhaarPhotosOnFile(docs: readonly KycPhotoDocLike[] | null | undefined): boolean {
  return aadhaarPhotosState(docs).ok;
}

export interface RequiredKycPhotosState<T extends KycPhotoDocLike> {
  /** Every required document has both sides on file. */
  ok: boolean;
  dl: KycPhotosState<T>;
  aadhaar: KycPhotosState<T>;
  /** Document types with a side still needed, DL first. */
  missingTypes: KycPhotoType[];
}

/** The combined "required documents" check: DL + Aadhaar, FRONT + BACK each. */
export function requiredKycPhotosState<T extends KycPhotoDocLike>(
  docs: readonly T[] | null | undefined,
): RequiredKycPhotosState<T> {
  const dl = kycPhotosState("DL", docs);
  const aadhaar = kycPhotosState("AADHAAR", docs);
  const missingTypes = REQUIRED_KYC_PHOTO_TYPES.filter((t) => !(t === "DL" ? dl : aadhaar).ok);
  return { ok: missingTypes.length === 0, dl, aadhaar, missingTypes };
}

export function hasRequiredKycPhotosOnFile(docs: readonly KycPhotoDocLike[] | null | undefined): boolean {
  return requiredKycPhotosState(docs).ok;
}

/** The 422 code: DL_PHOTOS_REQUIRED whenever the DL is incomplete, else AADHAAR_PHOTOS_REQUIRED. */
export function kycPhotosRequiredCode(missingTypes: readonly KycPhotoType[]): KycPhotosRequiredCode {
  return missingTypes.includes("DL") ? DL_PHOTOS_REQUIRED : AADHAAR_PHOTOS_REQUIRED;
}

/** The refusal message for the missing documents (names both when both are missing). */
export function kycPhotosRequiredMessage(
  missingTypes: readonly KycPhotoType[],
  audience: KycPhotosAudience = "customer",
): string {
  const dl = missingTypes.includes("DL");
  const aadhaar = missingTypes.includes("AADHAAR");
  if (dl && aadhaar) return audience === "staff" ? KYC_PHOTOS_REQUIRED_STAFF_MESSAGE : KYC_PHOTOS_REQUIRED_MESSAGE;
  if (aadhaar) return audience === "staff" ? AADHAAR_PHOTOS_REQUIRED_STAFF_MESSAGE : AADHAAR_PHOTOS_REQUIRED_MESSAGE;
  return audience === "staff" ? DL_PHOTOS_REQUIRED_STAFF_MESSAGE : DL_PHOTOS_REQUIRED_MESSAGE;
}

/** "front", "back" or "front and back" — for messages. */
export function describeKycPhotoSides(sides: readonly KycPhotoSide[]): string {
  return sides.map((s) => s.toLowerCase()).join(" and ");
}
