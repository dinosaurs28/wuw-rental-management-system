import { compressImage } from "@/lib/utils";

// Client-side checks for the customer QR code photo. The server repeats them
// (and also rejects undecodable images and anything under 300px a side).

export const QR_PHOTO_LABEL = "Customer QR code photo";
export const QR_PHOTO_HELPER = "e.g. Aadhaar or DigiLocker QR";

export const QR_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
export const QR_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const QR_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Validates the picked file and returns the one to upload. Photos over 10 MB
 * are downscaled once (1600px, JPEG 0.8 — still sharp enough for dense QR codes).
 */
export async function prepareQrPhotoFile(
  file: File,
): Promise<{ file: File } | { error: string }> {
  if (!QR_PHOTO_TYPES.includes(file.type)) {
    return { error: "Only JPG, PNG or WebP photos are accepted." };
  }
  if (file.size <= QR_PHOTO_MAX_BYTES) return { file };

  const smaller = await compressImage(file);
  if (smaller.size > QR_PHOTO_MAX_BYTES) {
    return { error: "The photo is larger than 10 MB. Please retake it." };
  }
  return { file: smaller };
}

type UploadErrorLike = {
  response?: { status?: number; data?: { code?: unknown; message?: unknown } };
};

export function qrPhotoErrorCode(err: unknown): string | undefined {
  const code = (err as UploadErrorLike | undefined)?.response?.data?.code;
  return typeof code === "string" ? code : undefined;
}

/** Server message when there is one; a 413 from a proxy has no JSON body. */
export function qrPhotoErrorMessage(err: unknown, fallback: string): string {
  const response = (err as UploadErrorLike | undefined)?.response;
  if (typeof response?.data?.message === "string") return response.data.message;
  if (response?.status === 413) return "The photo is larger than 10 MB. Please retake it.";
  if (!response) return "Couldn't reach the server. Check the connection and try again.";
  return fallback;
}
