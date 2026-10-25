/**
 * Display variants of public photos (pickup / return / damage): a ~1200 px
 * JPEG stored beside the original under `<key>__md.jpg`, its key saved in
 * FileObject.displayKey. Pure helpers — no I/O.
 */
import { isPrivateFile, publicFileUrl, type StoredFile } from "./file-url.js";

export const DISPLAY_VARIANT_SUFFIX = "__md.jpg";

/** Cache headers for photo objects: keys are unique per upload, never rewritten. */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** R2 key of the display copy of `key`. */
export function displayVariantKey(key: string): string {
  return `${key}${DISPLAY_VARIANT_SUFFIX}`;
}

export function isDisplayVariantKey(key: string): boolean {
  return key.endsWith(DISPLAY_VARIANT_SUFFIX);
}

export interface VariantFile extends StoredFile {
  mime: string;
  displayKey?: string | null;
}

/**
 * A display copy can be made for public images only: private files (KYC,
 * payment proofs) are presigned per view, and a variant would not be.
 */
export function canHaveDisplayVariant(file: VariantFile): boolean {
  return (
    !!file.key &&
    !isPrivateFile(file) &&
    /^https?:\/\//i.test(file.url) &&
    file.mime.toLowerCase().startsWith("image/") &&
    !isDisplayVariantKey(file.key)
  );
}

/**
 * `url` = the original (full-size viewer), `displayUrl` = the display copy on
 * the current R2_PUBLIC_URL, or the original when there is none (older photos,
 * no public base configured).
 */
export function photoUrls(
  file: VariantFile,
  base = process.env.R2_PUBLIC_URL,
): { url: string; displayUrl: string } {
  const url = publicFileUrl(file, base);
  const root = base?.trim().replace(/\/+$/, "");
  if (!file.displayKey || !root || !canHaveDisplayVariant(file)) return { url, displayUrl: url };
  return { url, displayUrl: `${root}/${file.displayKey}` };
}

// ── Only a display copy known to exist (Oct 25 2026) ─────────────────────────

/**
 * Display keys confirmed to be in the bucket (file id → key), so a drop screen
 * checks each copy once per process rather than on every view. Bounded: the
 * oldest entries are dropped past `max`.
 */
export class ConfirmedDisplayKeys {
  private readonly keys = new Map<number, string>();
  constructor(private readonly max = 20_000) {}
  has(fileId: number, displayKey: string): boolean {
    return this.keys.get(fileId) === displayKey;
  }
  add(fileId: number, displayKey: string): void {
    this.keys.delete(fileId);
    this.keys.set(fileId, displayKey);
    if (this.keys.size > this.max) this.keys.delete(this.keys.keys().next().value!);
  }
  get size(): number {
    return this.keys.size;
  }
}

export interface DisplayCopyDeps {
  /** The copy is in the bucket (true) / not found (false); throws on any other failure. */
  exists(displayKey: string): Promise<boolean>;
  /** FileObject.displayKey points at a missing object: clear it (only while it is still that key). */
  forget(fileId: number, displayKey: string): Promise<void>;
  /** Makes the copy of a photo without one: its key, or null when it can't be made (never throws). */
  make(file: VariantFile & { id: number; displayKey: null }): Promise<string | null>;
}

/**
 * The display key the drop screens may link to, or null = show the original.
 * A stored key is used once the object is confirmed in the bucket; a key whose
 * object is gone is cleared and the copy made again; a photo without one gets
 * it made now. A failed check or copy never points at a missing object.
 */
export async function confirmedDisplayKey(
  file: VariantFile & { id: number },
  deps: DisplayCopyDeps,
  confirmed: ConfirmedDisplayKeys,
): Promise<string | null> {
  if (!canHaveDisplayVariant(file)) return null;
  if (file.displayKey) {
    if (confirmed.has(file.id, file.displayKey)) return file.displayKey;
    let there: boolean;
    try {
      there = await deps.exists(file.displayKey);
    } catch {
      return null;
    }
    if (there) {
      confirmed.add(file.id, file.displayKey);
      return file.displayKey;
    }
    try {
      await deps.forget(file.id, file.displayKey);
    } catch {
      return null;
    }
  }
  const made = await deps.make({ ...file, displayKey: null }).catch(() => null);
  if (made) confirmed.add(file.id, made);
  return made;
}

/**
 * After writing a display copy for an older photo and saving its key with
 * `updateMany({ id, displayKey: null })`: "saved" (this request stored it),
 * "kept" (another request stored the same key first — the object is in use),
 * "orphan" (the photo was deleted meanwhile — remove the object just written).
 */
export function variantSaveOutcome(updated: number, rowExists: boolean): "saved" | "kept" | "orphan" {
  if (updated > 0) return "saved";
  return rowExists ? "kept" : "orphan";
}
