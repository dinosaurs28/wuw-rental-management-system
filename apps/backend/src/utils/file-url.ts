import { generatePresignedUrl } from "../services/r2-upload.js";

/** The FileObject columns needed to build a viewable link. */
export interface StoredFile {
  key: string;
  url: string;
}

/**
 * Private-bucket files (invoices, receipts, KYC, QR and payment-proof photos)
 * store the R2 key itself in `url`; public-bucket files (pickup / return /
 * damage photos, vehicle images) store an absolute `${R2_PUBLIC_URL}/${key}`.
 */
export function isPrivateFile(file: StoredFile): boolean {
  return file.url === file.key;
}

/**
 * Link for a public-bucket file, rebuilt from its key on the current
 * R2_PUBLIC_URL. Stored URLs keep whatever public domain was configured at
 * upload time, so moving the bucket to a new domain (e.g. off the rate-limited
 * r2.dev URL) would otherwise strand every photo uploaded before the move.
 * Anything not shaped `<base>/<key>` is returned as stored.
 */
export function publicFileUrl(file: StoredFile, base = process.env.R2_PUBLIC_URL): string {
  const root = base?.trim().replace(/\/+$/, "");
  if (!root || !file.key || !/^https?:\/\//i.test(file.url)) return file.url;
  if (!file.url.endsWith(`/${file.key}`)) return file.url;
  return `${root}/${file.key}`;
}

/**
 * Damage notes (DamageReport.notes) keep `damages[].photos[] = { publicId?, url }`
 * with the link as it was when recorded. Each photo matching one of `files`
 * (by publicId, else by its stored url) gets that file's publicFileUrl; the
 * notes are otherwise returned unchanged.
 */
export function withCurrentNotePhotoUrls<T>(
  notes: T,
  files: Array<StoredFile & { publicId: string }>,
): T {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return notes;
  const damages = (notes as Record<string, unknown>).damages;
  if (!Array.isArray(damages) || files.length === 0) return notes;

  const current = (photo: unknown) => {
    if (!photo || typeof photo !== "object") return photo;
    const p = photo as { publicId?: unknown; url?: unknown };
    const file =
      files.find((f) => typeof p.publicId === "string" && f.publicId === p.publicId) ??
      files.find((f) => typeof p.url === "string" && f.url === p.url);
    return file ? { ...p, url: publicFileUrl(file) } : photo;
  };

  return {
    ...notes,
    damages: damages.map((d) =>
      d && typeof d === "object" && Array.isArray((d as { photos?: unknown }).photos)
        ? { ...d, photos: (d as { photos: unknown[] }).photos.map(current) }
        : d,
    ),
  };
}

/**
 * The one way to turn a stored FileObject into a link a viewer can open:
 * public files get their permanent public URL (see publicFileUrl), private
 * files a fresh presigned GET (default 15 minutes) — never a link minted
 * earlier and saved somewhere.
 */
export async function resolveFileUrl(
  file: StoredFile,
  { ttlSeconds = 900 }: { ttlSeconds?: number } = {},
): Promise<string> {
  if (isPrivateFile(file)) return generatePresignedUrl(file.key, ttlSeconds);
  return publicFileUrl(file);
}
