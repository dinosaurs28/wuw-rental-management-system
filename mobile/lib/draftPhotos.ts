// Paused pickup / drop photos (Nov 3 2026, client: "the Images are disappearing
// randomly … only happens in App when we Pause the PickUp/Drop Flow").
//
// Pure helpers (no React Native imports — unit-tested under node):
//  - merging the photos a paused draft brings back with the ones already on the
//    screen, instead of replacing them;
//  - the on-phone record of shots that aren't in the server draft yet (still
//    uploading, failed, or uploaded but not saved with the draft when the screen
//    closed), so leaving the screen or the app being killed doesn't lose them.

export interface DraftPhotoLike {
  fileId: string;
  url: string;
  label?: string;
  // Set for shots taken on this phone (ms, see lib/photoOrder.nextCaptureAt).
  capturedAt?: number;
}

/** `photo` placed among `list` by when it was taken (photos without a time stay first). */
function insertByCaptureTime<T extends DraftPhotoLike>(list: T[], photo: T): T[] {
  const at = photo.capturedAt;
  if (at == null) return [...list, photo];
  const index = list.findIndex((p) => p.capturedAt != null && p.capturedAt > at);
  return index < 0 ? [...list, photo] : [...list.slice(0, index), photo, ...list.slice(index)];
}

/**
 * The photo list after a paused draft is restored: the saved photos, in their
 * saved order, plus every photo already on the screen that the draft doesn't
 * have — taken while the draft was loading, or brought back from this phone's
 * record of unsaved shots. A labelled slot keeps the saved photo unless the one
 * on the screen was taken on this phone (it is the newer retake).
 */
export function mergeRestoredPhotos<T extends DraftPhotoLike>(saved: T[], current: T[]): T[] {
  let result = dedupeByFileId(saved);
  for (const photo of current) {
    if (result.some((p) => p.fileId === photo.fileId)) continue;
    if (photo.label) {
      const index = result.findIndex((p) => p.label === photo.label);
      if (index >= 0) {
        if (photo.capturedAt == null) continue;
        result = [...result.slice(0, index), photo, ...result.slice(index + 1)];
        continue;
      }
    }
    result = insertByCaptureTime(result, photo);
  }
  return result;
}

/**
 * "Keep mine" after a draft conflict: this phone's photos stay as they are and
 * the other phone's extra photos are added after them (a labelled slot already
 * filled here keeps this phone's photo). Photos are evidence: never dropped.
 */
export function mergeKeepPhotos<T extends DraftPhotoLike>(mine: T[], other: T[]): T[] {
  const result = dedupeByFileId(mine);
  for (const photo of other) {
    if (result.some((p) => p.fileId === photo.fileId)) continue;
    if (photo.label && result.some((p) => p.label === photo.label)) continue;
    result.push(photo);
  }
  return result;
}

export function dedupeByFileId<T extends { fileId: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.fileId) ? false : (seen.add(p.fileId), true)));
}

/** What the server keeps of a photo list (order + file id + label). */
export const photoRefs = (photos: Array<{ fileId: string; label?: string | null }>) =>
  photos.map((p) => ({ fileId: p.fileId, label: p.label ?? null }));

// ── This phone's record of shots not in the server draft yet ────────────────

export const SHOT_RECORD_VERSION = 1;
// Older records are left behind (the booking was finished or abandoned).
export const SHOT_RECORD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredShot {
  // The shot's key on the screen (unique per shot).
  key: string;
  // A copy of the camera file in the app's documents folder (survives restarts).
  uri: string;
  width: number;
  label?: string;
  capturedAt: number;
  // Set once the upload finished: the server file it became.
  fileId?: string;
  url?: string;
}

/** The record's id for one pickup / drop of one vehicle (safe as a folder name). */
export function shotRecordKey(kind: string, bookingId: string, vehicleKey?: string | null): string {
  return `${shotRecordPrefix(kind, bookingId)}${safePart(vehicleKey || 'any')}`;
}

/** Every record of that pickup / drop, whatever the vehicle. */
export function shotRecordPrefix(kind: string, bookingId: string): string {
  return `${safePart(kind)}__${safePart(bookingId)}__`;
}

const safePart = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);

export function serializeShots(shots: StoredShot[], now = Date.now()): string {
  return JSON.stringify({ v: SHOT_RECORD_VERSION, savedAt: now, shots });
}

/** The stored shots, tolerant of a damaged or old file (never throws). */
export function parseShots(raw: string | null | undefined, now = Date.now()): StoredShot[] {
  if (!raw) return [];
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return [];
  }
  const rec = obj as { v?: unknown; shots?: unknown } | null;
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.shots)) return [];
  const seen = new Set<string>();
  return rec.shots.flatMap((s): StoredShot[] => {
    const shot = s as Partial<Record<keyof StoredShot, unknown>> | null;
    if (!shot || typeof shot !== 'object') return [];
    if (typeof shot.key !== 'string' || !shot.key || seen.has(shot.key)) return [];
    if (typeof shot.uri !== 'string' || !shot.uri) return [];
    if (typeof shot.capturedAt !== 'number' || !Number.isFinite(shot.capturedAt)) return [];
    if (now - shot.capturedAt > SHOT_RECORD_MAX_AGE_MS) return [];
    seen.add(shot.key);
    const uploaded = typeof shot.fileId === 'string' && !!shot.fileId && typeof shot.url === 'string';
    return [{
      key: shot.key,
      uri: shot.uri,
      width: typeof shot.width === 'number' && shot.width > 0 ? shot.width : 0,
      ...(typeof shot.label === 'string' && shot.label ? { label: shot.label } : {}),
      capturedAt: shot.capturedAt,
      ...(uploaded ? { fileId: shot.fileId as string, url: shot.url as string } : {}),
    }];
  });
}

/** Uploaded shots as photos for the screen's list (in the order taken). */
export function uploadedShotPhotos(shots: StoredShot[]): DraftPhotoLike[] {
  return shots
    .filter((s) => s.fileId && s.url)
    .sort((a, b) => a.capturedAt - b.capturedAt)
    .map((s) => ({
      fileId: s.fileId as string,
      url: s.url as string,
      capturedAt: s.capturedAt,
      ...(s.label ? { label: s.label } : {}),
    }));
}

/** Shots whose upload hasn't finished (to upload again). */
export const unuploadedShots = (shots: StoredShot[]) => shots.filter((s) => !s.fileId);

/** The record without the shots that became one of `fileIds` (saved with the server draft). */
export const withoutFileIds = (shots: StoredShot[], fileIds: Iterable<string>) => {
  const ids = new Set(fileIds);
  return shots.filter((s) => !s.fileId || !ids.has(s.fileId));
};
