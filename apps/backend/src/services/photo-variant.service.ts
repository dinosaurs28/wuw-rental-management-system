/**
 * Display copies (~1200 px JPEG, `<key>__md.jpg`) of public pickup / return /
 * damage photos, for the drop screen strips. New uploads store one right away
 * (putDisplayVariant); photos uploaded before Oct 18 2026 get one the first
 * time a drop screen asks for them (ensureDisplayVariants). The original is
 * never touched, and every failure leaves the photo on its original URL. A
 * stored copy is linked only once it is confirmed in the bucket (Oct 25 2026).
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "@repo/database/client";
import { r2, PUBLIC_BUCKET } from "../lib/r2.client.js";
import { processDisplayImage } from "../utils/image-processor.js";
import {
  ConfirmedDisplayKeys,
  IMMUTABLE_CACHE_CONTROL,
  canHaveDisplayVariant,
  confirmedDisplayKey,
  displayVariantKey,
  variantSaveOutcome,
  type DisplayCopyDeps,
  type VariantFile,
} from "../utils/photo-variant.js";

const R2_TIMEOUT_MS = 20_000;
/** Photos processed at once across all requests (sharp + R2 round trips). */
const MAX_CONCURRENT = 4;
/** A photo whose copy could not be made is not retried for this long. */
const FAILURE_BACKOFF_MS = 10 * 60_000;

async function uploadDisplayVariant(key: string, source: Buffer): Promise<string> {
  const display = await processDisplayImage(source);
  const displayKey = displayVariantKey(key);
  await r2.send(
    new PutObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: displayKey,
      Body: display.buffer,
      ContentType: display.mimeType,
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
    { abortSignal: AbortSignal.timeout(R2_TIMEOUT_MS) },
  );
  return displayKey;
}

/**
 * Stores the display copy of a photo being uploaded (`source` = the processed
 * original). Returns its key for FileObject.displayKey, or null when it could
 * not be made — the upload itself must not fail over it.
 */
export async function putDisplayVariant(key: string, source: Buffer): Promise<string | null> {
  try {
    return await uploadDisplayVariant(key, source);
  } catch (error) {
    console.warn(`[photo-variant] Could not store the display copy of ${key}:`, error);
    return null;
  }
}

/** Removes a display copy no FileObject points at (best effort, logged). */
export async function discardDisplayVariant(displayKey: string | null | undefined): Promise<void> {
  if (!displayKey) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: PUBLIC_BUCKET, Key: displayKey }), {
      abortSignal: AbortSignal.timeout(R2_TIMEOUT_MS),
    });
  } catch (error) {
    console.warn(`[photo-variant] Could not remove the unused display copy ${displayKey}:`, error);
  }
}

// ── Older photos: made on first view ─────────────────────────────────────────

export interface VariantCandidate extends VariantFile {
  id: number;
}

let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

const inFlight = new Map<number, Promise<string | null>>();
const failedAt = new Map<number, number>();

async function generateFromOriginal(file: VariantCandidate): Promise<string | null> {
  const object = await r2.send(new GetObjectCommand({ Bucket: PUBLIC_BUCKET, Key: file.key }), {
    abortSignal: AbortSignal.timeout(R2_TIMEOUT_MS),
  });
  if (!object.Body) throw new Error("empty object");
  const source = Buffer.from(await object.Body.transformToByteArray());
  const displayKey = await uploadDisplayVariant(file.key, source);
  const { count } = await prisma.fileObject.updateMany({
    where: { id: file.id, displayKey: null },
    data: { displayKey },
  });
  const rowExists = count > 0 || (await prisma.fileObject.count({ where: { id: file.id } })) > 0;
  const outcome = variantSaveOutcome(count, rowExists);
  if (outcome === "orphan") {
    // The photo was deleted while its copy was being made.
    await discardDisplayVariant(displayKey);
    return null;
  }
  // "kept": another request saved the same key first — the object is in use.
  return displayKey;
}

/** The display copy of one older photo, made once even when asked for concurrently. */
export function ensureDisplayVariant(file: VariantCandidate): Promise<string | null> {
  if (file.displayKey) return Promise.resolve(file.displayKey);
  if (!PUBLIC_BUCKET || !canHaveDisplayVariant(file)) return Promise.resolve(null);
  const failed = failedAt.get(file.id);
  if (failed && Date.now() - failed < FAILURE_BACKOFF_MS) return Promise.resolve(null);

  const existing = inFlight.get(file.id);
  if (existing) return existing;

  const job = withSlot(() => generateFromOriginal(file))
    .then((key) => {
      failedAt.delete(file.id);
      return key;
    })
    .catch((error) => {
      failedAt.set(file.id, Date.now());
      console.warn(`[photo-variant] Could not make the display copy of ${file.key}:`, error?.message ?? error);
      return null;
    })
    .finally(() => inFlight.delete(file.id));
  inFlight.set(file.id, job);
  return job;
}

// Display keys checked to be in the bucket (once per process per photo)
const confirmedKeys = new ConfirmedDisplayKeys();

function isNotFound(error: any): boolean {
  return error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
}

const displayCopyDeps: DisplayCopyDeps = {
  async exists(displayKey) {
    try {
      await r2.send(new HeadObjectCommand({ Bucket: PUBLIC_BUCKET, Key: displayKey }), {
        abortSignal: AbortSignal.timeout(R2_TIMEOUT_MS),
      });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  },
  async forget(fileId, displayKey) {
    console.warn(`[photo-variant] Display copy ${displayKey} is missing from the bucket — making it again`);
    await prisma.fileObject.updateMany({ where: { id: fileId, displayKey }, data: { displayKey: null } });
  },
  make: (file) => ensureDisplayVariant(file),
};

/**
 * The display copies of `files` the drop screens may link to, waiting at most
 * `budgetMs`. Returns file id → displayKey for every copy confirmed in the
 * bucket by then (stored and checked, or just made); a photo left out shows
 * from its original URL (a missing / unmade copy is never linked), and the
 * unfinished copies keep going in the background for the next view.
 */
export async function ensureDisplayVariants(
  files: VariantCandidate[],
  { budgetMs = 3000 }: { budgetMs?: number } = {},
): Promise<Map<number, string>> {
  const ready = new Map<number, string>();
  const jobs: Promise<unknown>[] = [];
  if (!PUBLIC_BUCKET) return ready;
  for (const file of files) {
    jobs.push(
      confirmedDisplayKey(file, displayCopyDeps, confirmedKeys)
        .then((key) => {
          if (key) ready.set(file.id, key);
        })
        .catch(() => {}),
    );
  }
  if (jobs.length > 0) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.all(jobs),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, budgetMs);
      }),
    ]);
    clearTimeout(timer);
  }
  return new Map(ready);
}
