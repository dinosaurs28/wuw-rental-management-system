/**
 * Driving licence photos are compulsory to book (client, Oct 17 2026).
 * Keep in sync with mobile/lib/dlPhotos.ts (the app doesn't import @repo/schemas).
 *
 * A customer has their DL photos "on file" when there is a DL KYC document for
 * BOTH the FRONT and the BACK side whose status is not REJECTED — PENDING
 * (uploaded, not yet checked by staff) and APPROVED both count. A rejected side
 * has to be replaced before the next booking.
 *
 * Checked at customer booking create (HOLD), staff walk-in booking create and
 * shown at pickup. Refusals are 422 DL_PHOTOS_REQUIRED.
 */

export const DL_PHOTOS_REQUIRED = "DL_PHOTOS_REQUIRED" as const;

export const DL_PHOTOS_REQUIRED_MESSAGE = "Upload both sides of your driving licence to book.";

/** Staff wording (walk-in create / pickup). */
export const DL_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's driving licence before creating the booking.";

export type DlPhotoSide = "FRONT" | "BACK";

export const DL_PHOTO_SIDES: readonly DlPhotoSide[] = ["FRONT", "BACK"];

/** The minimum a KYC row needs for the rule (API rows, Prisma rows). */
export interface DlPhotoDocLike {
  type: string;
  side: string;
  status: string;
}

/** True when the document is a DL photo of `side` that counts (not REJECTED). */
export function isUsableDlPhoto(doc: DlPhotoDocLike, side?: DlPhotoSide): boolean {
  return doc.type === "DL" && (side === undefined || doc.side === side) && doc.status !== "REJECTED";
}

export interface DlPhotosState<T extends DlPhotoDocLike> {
  /** Both sides on file (not rejected). */
  ok: boolean;
  /** The usable FRONT / BACK documents, if any. */
  front: T | null;
  back: T | null;
  /** Sides still needed, FRONT first. */
  missingSides: DlPhotoSide[];
  /** Sides on file but REJECTED by staff (to be replaced). */
  rejectedSides: DlPhotoSide[];
}

export function dlPhotosState<T extends DlPhotoDocLike>(docs: readonly T[] | null | undefined): DlPhotosState<T> {
  const list = docs ?? [];
  const front = list.find((d) => isUsableDlPhoto(d, "FRONT")) ?? null;
  const back = list.find((d) => isUsableDlPhoto(d, "BACK")) ?? null;
  const missingSides = DL_PHOTO_SIDES.filter((s) => (s === "FRONT" ? !front : !back));
  const rejectedSides = missingSides.filter((s) =>
    list.some((d) => d.type === "DL" && d.side === s && d.status === "REJECTED"),
  );
  return { ok: missingSides.length === 0, front, back, missingSides, rejectedSides };
}

export function hasDlPhotosOnFile(docs: readonly DlPhotoDocLike[] | null | undefined): boolean {
  return dlPhotosState(docs).ok;
}

/** "front", "back" or "front and back" — for messages. */
export function describeDlPhotoSides(sides: readonly DlPhotoSide[]): string {
  return sides.map((s) => s.toLowerCase()).join(" and ");
}
