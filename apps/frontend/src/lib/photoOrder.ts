// Vehicle condition photos in the order they were taken (Oct 22 2026, client:
// "photo click madid order alli upload agbeku, plus ade order alli drop time ge
// view madlike agbeku"). Uploads can overlap and finish in any order: each photo
// is stamped when it's picked / taken and lands in the list at that place.

let lastCaptureAt = 0;

/** When a photo was taken / picked (ms) — strictly increasing, so two never tie. */
export function nextCaptureAt(): number {
  lastCaptureAt = Math.max(Date.now(), lastCaptureAt + 1);
  return lastCaptureAt;
}

/**
 * `photo` placed among `list` by when it was taken: before the first photo
 * taken after it. Photos without a time (saved earlier, prefilled for an edit)
 * stay where they are, first.
 */
export function insertInCaptureOrder<T extends { capturedAt?: number }>(list: T[], photo: T): T[] {
  const at = photo.capturedAt;
  if (at == null) return [...list, photo];
  const index = list.findIndex((p) => p.capturedAt != null && p.capturedAt > at);
  return index < 0 ? [...list, photo] : [...list.slice(0, index), photo, ...list.slice(index)];
}

/** A copy in the order taken (photos without a time first, as they were). */
export function sortByCaptureOrder<T extends { capturedAt?: number }>(list: T[]): T[] {
  const key = (p: T) => p.capturedAt ?? Number.NEGATIVE_INFINITY;
  return list
    .map((photo, i) => ({ photo, i }))
    .sort((a, b) => (key(a.photo) === key(b.photo) ? a.i - b.i : key(a.photo) < key(b.photo) ? -1 : 1))
    .map((x) => x.photo);
}
