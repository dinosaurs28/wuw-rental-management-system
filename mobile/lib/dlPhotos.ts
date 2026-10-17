/**
 * Driving licence photos are compulsory to book (client, Oct 17 2026).
 * Mirrors packages/schemas/src/dl-photos.ts by hand — the app doesn't import
 * @repo/schemas. Keep the two in step.
 *
 * Both DL sides (FRONT + BACK) must be on file and not REJECTED — PENDING and
 * APPROVED both count. The server refuses customer booking create and staff
 * walk-in create without them: 422 DL_PHOTOS_REQUIRED. A rejected side the
 * customer uploads again replaces the old photo.
 */

export const DL_PHOTOS_REQUIRED = 'DL_PHOTOS_REQUIRED';

export const DL_PHOTOS_REQUIRED_MESSAGE = 'Upload both sides of your driving licence to book.';

export const DL_PHOTOS_REQUIRED_STAFF_MESSAGE =
  "Capture both sides of the customer's driving licence before creating the booking.";

export type DlPhotoSide = 'FRONT' | 'BACK';

export const DL_PHOTO_SIDES: readonly DlPhotoSide[] = ['FRONT', 'BACK'];

export interface DlPhotoDocLike {
  type: string;
  side: string;
  status?: string;
}

export function isUsableDlPhoto(doc: DlPhotoDocLike, side?: DlPhotoSide): boolean {
  return doc.type === 'DL' && (side === undefined || doc.side === side) && doc.status !== 'REJECTED';
}

export interface DlPhotosState<T extends DlPhotoDocLike> {
  ok: boolean;
  front: T | null;
  back: T | null;
  missingSides: DlPhotoSide[];
  rejectedSides: DlPhotoSide[];
}

export function dlPhotosState<T extends DlPhotoDocLike>(docs: readonly T[] | null | undefined): DlPhotosState<T> {
  const list = docs ?? [];
  const front = list.find((d) => isUsableDlPhoto(d, 'FRONT')) ?? null;
  const back = list.find((d) => isUsableDlPhoto(d, 'BACK')) ?? null;
  const missingSides = DL_PHOTO_SIDES.filter((s) => (s === 'FRONT' ? !front : !back));
  const rejectedSides = missingSides.filter((s) =>
    list.some((d) => d.type === 'DL' && d.side === s && d.status === 'REJECTED'),
  );
  return { ok: missingSides.length === 0, front, back, missingSides, rejectedSides };
}

export function hasDlPhotosOnFile(docs: readonly DlPhotoDocLike[] | null | undefined): boolean {
  return dlPhotosState(docs).ok;
}

/** "front", "back" or "front and back". */
export function describeDlPhotoSides(sides: readonly DlPhotoSide[]): string {
  return sides.map((s) => s.toLowerCase()).join(' and ');
}
