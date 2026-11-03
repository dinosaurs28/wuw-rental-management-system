// On-phone record of pickup / drop shots that aren't in the server draft yet
// (Nov 3 2026 paused-photo fix). Each shot taken on a pickup / drop screen is
// moved out of the camera cache into the app's documents folder and listed in
// <documents>/pending-photos/<record>/shots.json until the server draft holds
// it (or the operation is completed / discarded). Leaving the screen while a
// photo uploads, a failed upload, or the app being killed no longer loses it:
// the screen brings it back the next time that pickup / drop is opened on this
// phone, finishing or retrying the upload.
//
// Uploads run outside the screen (an upload started before leaving still
// finishes and is recorded), and one shot is never uploaded twice at once.
//
// expo-file-system ships with the Expo SDK (a dependency of `expo`). It is
// loaded lazily: without it everything here is a no-op and the screens work as
// before (photos kept in memory only).
import {
  parseShots,
  serializeShots,
  withoutFileIds,
  type StoredShot,
} from './draftPhotos';

type FsModule = typeof import('expo-file-system');

let fsModule: FsModule | null | undefined;
function fs(): FsModule | null {
  if (fsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      fsModule = require('expo-file-system') as FsModule;
      // Touch the native side once so a missing module shows up here, not later.
      void fsModule.Paths.document.uri;
    } catch {
      fsModule = null;
    }
  }
  return fsModule;
}

/** Tests only: run the store against a stand-in for expo-file-system. */
export function __setFileSystemForTests(mod: unknown) {
  fsModule = mod as FsModule | null;
  pruned = false;
  cache.clear();
  inFlight.clear();
}

const ROOT = 'pending-photos';
const RECORD_FILE = 'shots.json';

let pruned = false;

function rootDir() {
  const m = fs();
  if (!m) return null;
  const dir = new m.Directory(m.Paths.document, ROOT);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  if (!pruned) {
    pruned = true;
    pruneOld(m, dir);
  }
  return dir;
}

// Once per app run: records with nothing left in them (every shot older than
// SHOT_RECORD_MAX_AGE_MS — a pickup / drop finished on the web or abandoned).
function pruneOld(m: FsModule, root: InstanceType<FsModule['Directory']>) {
  try {
    for (const entry of root.list()) {
      if (!(entry instanceof m.Directory)) continue;
      const file = new m.File(entry, RECORD_FILE);
      const shots = file.exists ? parseShots(file.textSync()) : [];
      if (shots.length === 0) entry.delete();
    }
  } catch {
    /* ignore */
  }
}

function recordDir(record: string, create: boolean) {
  const m = fs();
  const root = rootDir();
  if (!m || !root) return null;
  const dir = new m.Directory(root, record);
  if (create && !dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Shots can be kept on this phone (documents folder available). */
export function shotRecordAvailable(): boolean {
  try {
    return !!rootDir();
  } catch {
    return false;
  }
}

const cache = new Map<string, StoredShot[]>();

/** The record's shots (read once from disk, then from memory). Never throws. */
export function loadShots(record: string): StoredShot[] {
  const hit = cache.get(record);
  if (hit) return hit;
  let shots: StoredShot[] = [];
  try {
    const m = fs();
    const dir = recordDir(record, false);
    if (m && dir?.exists) {
      const file = new m.File(dir, RECORD_FILE);
      shots = file.exists ? parseShots(file.textSync()) : [];
      // A shot whose image file is gone can't be uploaded again (an uploaded one still shows).
      shots = shots.filter((s) => s.fileId || new m.File(s.uri).exists);
    }
  } catch {
    shots = [];
  }
  cache.set(record, shots);
  return shots;
}

function save(record: string, shots: StoredShot[]) {
  cache.set(record, shots);
  try {
    const m = fs();
    const dir = recordDir(record, shots.length > 0);
    if (!m || !dir) return;
    if (shots.length === 0) {
      if (dir.exists) dir.delete();
      return;
    }
    const file = new m.File(dir, RECORD_FILE);
    if (!file.exists) file.create({ overwrite: true });
    file.write(serializeShots(shots));
  } catch {
    // Best effort: the in-memory copy still covers this app session.
  }
}

function deleteImage(uri: string) {
  try {
    const m = fs();
    const root = rootDir();
    // Only files this store made (never a camera / cache file it didn't move).
    if (!m || !root || !uri.startsWith(root.uri)) return;
    const file = new m.File(uri);
    if (file.exists) file.delete();
  } catch {
    /* ignore */
  }
}

/**
 * Keeps a new shot: moves the camera file into the record's folder (the camera
 * cache can be cleared by the OS) and lists it. Returns the shot's durable uri
 * (the original one when the file couldn't be moved).
 */
export function keepShot(record: string, shot: Omit<StoredShot, 'fileId' | 'url'>): string {
  let uri = shot.uri;
  try {
    const m = fs();
    const dir = recordDir(record, true);
    if (m && dir) {
      const src = new m.File(shot.uri);
      const ext = /\.[A-Za-z0-9]{2,5}$/.exec(shot.uri)?.[0] ?? '.jpg';
      const dest = new m.File(dir, `${shot.key.replace(/[^A-Za-z0-9_-]/g, '-')}${ext}`);
      try {
        src.move(dest);
        uri = src.uri;
      } catch {
        src.copy(dest);
        uri = dest.uri;
      }
    }
  } catch {
    uri = shot.uri;
  }
  const shots = loadShots(record).filter((s) => s.key !== shot.key);
  save(record, [...shots, { ...shot, uri }]);
  return uri;
}

/** The shot's upload finished: it's now that server file (kept until the draft has it). */
export function markShotUploaded(record: string, key: string, fileId: string, url: string) {
  const shots = loadShots(record);
  if (!shots.some((s) => s.key === key)) return;
  save(record, shots.map((s) => (s.key === key ? { ...s, fileId, url } : s)));
}

/** Staff removed a shot that never uploaded. */
export function dropShot(record: string, key: string) {
  const shots = loadShots(record);
  const gone = shots.filter((s) => s.key === key);
  if (gone.length === 0) return;
  gone.forEach((s) => deleteImage(s.uri));
  save(record, shots.filter((s) => s.key !== key));
}

/**
 * These server files no longer need the phone's copy: the server draft holds
 * them (a save landed / the draft was restored), or staff removed the photo.
 */
export function forgetFileIds(record: string, fileIds: Iterable<string>) {
  const shots = loadShots(record);
  const kept = withoutFileIds(shots, fileIds);
  if (kept.length === shots.length) return;
  const keptKeys = new Set(kept.map((s) => s.key));
  shots.filter((s) => !keptKeys.has(s.key)).forEach((s) => deleteImage(s.uri));
  save(record, kept);
}

/** The pickup / drop was completed or discarded: every record of it goes. */
export function clearShotRecords(prefix: string) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
  try {
    const root = rootDir();
    if (!root) return;
    for (const entry of root.list()) {
      if (entry.name.startsWith(prefix)) entry.delete();
    }
  } catch {
    /* ignore */
  }
}

// ── Uploads in progress (outlive the screen that started them) ──────────────

export type ShotUploadResult = { fileId: string; url: string };
const inFlight = new Map<string, Promise<ShotUploadResult>>();

/**
 * Runs `start` for the shot unless an upload of it is already running (then
 * that one is joined). The result is recorded in `record` even when the screen
 * that started it has closed.
 */
export function uploadShot(
  record: string | null,
  key: string,
  start: () => Promise<ShotUploadResult>,
): Promise<ShotUploadResult> {
  const running = inFlight.get(key);
  if (running) return running;
  const run = (async () => {
    const result = await start();
    if (record) markShotUploaded(record, key, result.fileId, result.url);
    return result;
  })();
  inFlight.set(key, run);
  const clear = () => {
    if (inFlight.get(key) === run) inFlight.delete(key);
  };
  run.then(clear, clear);
  return run;
}

/** An upload of this shot is running (started by this or an earlier screen). */
export const shotUploading = (key: string) => inFlight.has(key);
