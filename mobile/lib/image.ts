import * as ImageManipulator from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

// Shared pre-upload image pipeline.
//
// Why this exists: the API sits behind nginx, whose `client_max_body_size`
// governs how large a multipart request may be. A raw phone photo (12MP, often
// 3–8 MB) exceeds a default-configured nginx and is rejected with 413 before it
// ever reaches Express — so the upload fails with no server-side log. Shrinking
// every image to a predictable size here keeps uploads well inside any sane
// limit and makes them far faster on mobile data.
//
// 1280px wide at quality 0.55 keeps a driving licence perfectly legible while
// landing at roughly 120–350 KB.
export const UPLOAD_MAX_WIDTH = 1280;
export const UPLOAD_QUALITY = 0.55;

// Damage evidence needs the detail of scratches, dents and cracks, which the
// licence profile smears. 2000px matches the server's own resize cap.
export const DAMAGE_MAX_WIDTH = 2000;
export const DAMAGE_QUALITY = 0.8;

// A customer QR code photo (Aadhaar secure QR etc.) is dense; the licence
// profile's blur makes it unreadable. ~1600px at q0.8 keeps the modules sharp.
export const QR_MAX_WIDTH = 1600;
export const QR_QUALITY = 0.8;

export type UploadProfile = 'standard' | 'damage' | 'qr';

const PROFILES: Record<UploadProfile, { width: number; quality: number }> = {
  standard: { width: UPLOAD_MAX_WIDTH, quality: UPLOAD_QUALITY },
  damage: { width: DAMAGE_MAX_WIDTH, quality: DAMAGE_QUALITY },
  qr: { width: QR_MAX_WIDTH, quality: QR_QUALITY },
};

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * Resize + re-encode a picked image to a predictable, upload-safe JPEG.
 *
 * `baseName` is used verbatim as the filename stem (no extension). If
 * manipulation fails for any reason the original asset is returned unchanged so
 * the user can still attempt the upload.
 */
export async function prepareImageForUpload(
  asset: Pick<ImagePickerAsset, 'uri' | 'mimeType' | 'width'>,
  baseName: string,
  profile: UploadProfile = 'standard',
): Promise<UploadFile> {
  try {
    const { width: maxWidth, quality } = PROFILES[profile];
    // Only downscale — `resize: { width }` would otherwise upscale a small
    // image, inflating it for no benefit.
    const actions =
      asset.width && asset.width > maxWidth
        ? [{ resize: { width: maxWidth } }]
        : [];

    const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: quality,
      format: ImageManipulator.SaveFormat.JPEG,
    });

    return { uri: out.uri, name: `${baseName}.jpg`, type: 'image/jpeg' };
  } catch {
    // Manipulation unavailable/failed — fall back to the original asset.
    const mime = asset.mimeType ?? 'image/jpeg';
    const ext = EXT_BY_MIME[mime] ?? asset.uri.split('.').pop() ?? 'jpg';
    return { uri: asset.uri, name: `${baseName}.${ext}`, type: mime };
  }
}

/**
 * Build a multipart body for a single-image upload.
 */
export function toUploadForm(
  file: UploadFile,
  extraFields: Record<string, string> = {},
): FormData {
  const form = new FormData();
  form.append('file', file as any);
  for (const [key, value] of Object.entries(extraFields)) {
    form.append(key, value);
  }
  return form;
}

/**
 * Human-readable reason an upload failed.
 *
 * 413 is called out explicitly: it comes from the reverse proxy, not the app,
 * so the generic server message is empty and the failure is otherwise silent.
 */
export function uploadErrorMessage(err: any, fallback = 'Could not upload the photo.'): string {
  const status = err?.response?.status;

  if (status === 413) {
    return 'That image is too large for the server to accept. Try a smaller photo, or contact support if this keeps happening.';
  }
  if (status === 409) {
    return 'This document already exists. Remove it first to replace it.';
  }
  if (err?.code === 'ECONNABORTED') {
    return 'The upload timed out. Check your connection and try again.';
  }
  if (typeof err?.message === 'string' && err.message.includes('Network')) {
    return 'Cannot reach the server. Check your connection.';
  }

  return err?.response?.data?.message ?? fallback;
}
