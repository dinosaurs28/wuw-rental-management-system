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
