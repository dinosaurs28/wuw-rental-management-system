/**
 * Vehicle condition photos in the order they were taken (Oct 22 2026, client
 * request: "photo click madid order alli upload agbeku, plus ade order alli drop
 * time ge view madlike agbeku").
 *
 * Uploads run in parallel and retry, so they finish — and their FileObjects are
 * created — in a different order than the shots were taken. Each BookingPhoto
 * records `captureOrder`: its 0-based place in its set (the pickup's photos,
 * one swap's photos of the replacement, the return's photos, one damage
 * report's photos), from the order the client sends the photos in.
 *
 * Reading: by captureOrder; rows saved before it existed (null) come first, in
 * the old order (createdAt, then id).
 */
import type { Prisma } from "@repo/database/client";

/** Prisma orderBy for BookingPhoto lists: capture order, then the old order. */
export const bookingPhotoOrderBy = (): Prisma.BookingPhotoOrderByWithRelationInput[] => [
  { captureOrder: { sort: "asc", nulls: "first" } },
  { createdAt: "asc" },
  { id: "asc" },
];

export interface OrderablePhoto {
  captureOrder?: number | null;
  createdAt?: Date | string | null;
  id?: number | null;
}

const time = (v: Date | string | null | undefined): number => {
  if (v == null) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Compare like BOOKING_PHOTO_ORDER_BY (null captureOrder first, then createdAt, then id). */
export function compareBookingPhotos(a: OrderablePhoto, b: OrderablePhoto): number {
  const ao = a.captureOrder ?? null;
  const bo = b.captureOrder ?? null;
  if (ao !== bo) {
    if (ao === null) return -1;
    if (bo === null) return 1;
    return ao - bo;
  }
  const dt = time(a.createdAt) - time(b.createdAt);
  if (dt !== 0) return dt;
  return (a.id ?? 0) - (b.id ?? 0);
}

/** A sorted copy (the input is left as it is). */
export function sortBookingPhotos<T extends OrderablePhoto>(photos: readonly T[]): T[] {
  return [...photos].sort(compareBookingPhotos);
}

/**
 * Photos in capture order: by their place in `photoOrder` (the file ids in the
 * order they were taken, sent by newer app builds), else as sent. Photos missing
 * from `photoOrder` keep their sent order after the ones in it. Stable.
 */
export function orderByCapture<T extends { fileId: string }>(items: readonly T[], photoOrder?: readonly string[] | null): T[] {
  if (!photoOrder || photoOrder.length === 0) return [...items];
  const rank = new Map<string, number>();
  photoOrder.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  return items
    .map((item, i) => ({ item, i, r: rank.get(item.fileId) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.item);
}

/**
 * The next free captureOrder of a set: one past the highest saved (0 for a set
 * with none, or only rows from before captureOrder) — photos added later (an
 * edit, a recomputed drop) go after the ones already there.
 */
export function nextCaptureOrder(highest: number | null | undefined): number {
  return highest == null ? 0 : highest + 1;
}

type CaptureOrderDb = Pick<Prisma.TransactionClient, "bookingPhoto">;

/** nextCaptureOrder for the BookingPhoto rows matching `where` (one set). */
export async function captureOrderStart(db: CaptureOrderDb, where: Prisma.BookingPhotoWhereInput): Promise<number> {
  const agg = await db.bookingPhoto.aggregate({ where, _max: { captureOrder: true } });
  return nextCaptureOrder(agg._max.captureOrder);
}

/**
 * A list mixing several sets (pickup, swaps, return, damage reports): the most
 * recently saved set first — as such lists showed before — and each set in the
 * order its photos were taken.
 */
export function sortPhotoSetsNewestFirst<T extends OrderablePhoto>(
  photos: readonly T[],
  setKey: (photo: T) => string,
): T[] {
  const sets = new Map<string, T[]>();
  for (const photo of photos) {
    const key = setKey(photo);
    const set = sets.get(key);
    if (set) set.push(photo);
    else sets.set(key, [photo]);
  }
  const newest = (set: T[]) => Math.max(...set.map((p) => time(p.createdAt)));
  const lastId = (set: T[]) => Math.max(...set.map((p) => p.id ?? 0));
  return [...sets.values()]
    .sort((a, b) => newest(b) - newest(a) || lastId(b) - lastId(a))
    .flatMap((set) => sortBookingPhotos(set));
}

/** The set a BookingPhoto belongs to (for sortPhotoSetsNewestFirst). */
export const bookingPhotoSetKey = (p: {
  type: string;
  swapId?: number | null;
  damageReportId?: number | null;
}): string => `${p.type}:${p.swapId ?? ""}:${p.damageReportId ?? ""}`;
