// Vehicle condition photos in the order they were taken (Oct 22 2026, client:
// "photo click madid order alli upload agbeku, plus ade order alli drop time ge
// view madlike agbeku"). Uploads run in parallel and retry, so they finish in a
// different order than the shots were taken: each shot is stamped when it's
// taken and lands in the list at that place, whenever its upload finishes.

let lastCaptureAt = 0;

/** When a shot was taken (ms) — strictly increasing, so two shots never tie. */
export function nextCaptureAt(): number {
  lastCaptureAt = Math.max(Date.now(), lastCaptureAt + 1);
  return lastCaptureAt;
}

/**
 * `photo` placed among `list` by when it was taken: before the first photo
 * taken after it. Photos without a time (saved earlier, brought back from a
 * paused pickup / drop, or prefilled for an edit) stay where they are, first.
 */
export function insertInCaptureOrder<T extends { capturedAt?: number }>(list: T[], photo: T): T[] {
  const at = photo.capturedAt;
  if (at == null) return [...list, photo];
  const index = list.findIndex((p) => p.capturedAt != null && p.capturedAt > at);
  return index < 0 ? [...list, photo] : [...list.slice(0, index), photo, ...list.slice(index)];
}
