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
): Promise<UploadFile> {
  try {
    // Only downscale — `resize: { width }` would otherwise upscale a small
    // image, inflating it for no benefit.
    const actions =
      asset.width && asset.width > UPLOAD_MAX_WIDTH
        ? [{ resize: { width: UPLOAD_MAX_WIDTH } }]
        : [];

    const out = await ImageManipulator.manipulateAsync(asset.uri, actions, {
      compress: UPLOAD_QUALITY,
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
